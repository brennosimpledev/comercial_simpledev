import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// Rascunho da primeira mensagem do vendedor depois que o bot atendeu o lead.
//
// Na primeira semana do bot, o time abria toda conversa com o mesmo texto
// ("vou dar continuidade... prefere mensagem ou ligacao?") e perguntava de
// novo o que o cliente ja tinha contado. Aqui a mensagem nasce do que o
// cliente disse. Nada e enviado: o vendedor revisa e decide.

const MODELO = process.env.CONTINUIDADE_MODELO ?? "claude-opus-5-5";

const INICIO_BLOCO = "--- Atendimento do bot ---";
const FIM_BLOCO = "--- fim do resumo do bot ---";

const SISTEMA = `Você escreve, para o Ronaldo, vendedor da SimpleDEV (desenvolvimento de software sob medida), a próxima mensagem de WhatsApp para um lead.

Na maioria dos casos o lead já conversou com o assistente automático fora do horário, e existe um resumo do que ele disse. Sua mensagem continua essa conversa: o cliente não pode sentir que está começando do zero.

COMO ESCREVER
- Português do Brasil, tom de WhatsApp, cordial e direto. De 2 a 4 linhas curtas. Sem markdown, no máximo um emoji.
- Cumprimente pelo primeiro nome com a saudação certa para o horário informado.
- Em uma frase, mostre que leu o que ele contou, com as palavras dele (por exemplo: "vi que você quer um app tipo Mercado Livre para serviço de frete").
- Não pergunte de novo nada que ele já respondeu. Não use frases genéricas como "vou dar continuidade ao seu atendimento" ou "consegue me contar mais detalhes?".
- Pode se apresentar em poucas palavras ("aqui é o Ronaldo, da SimpleDEV") se ainda não houve mensagem do Ronaldo na conversa.
- Termine com UM próximo passo claro:
  - Se o lead parece qualificado: proponha uma conversa rápida com o especialista, oferecendo ligação ou reunião hoje ou amanhã.
  - Se falta entender a ideia: faça uma única pergunta, específica, sobre o que ele quer desenvolver.
  - Se o assistente avaliou como não qualificado por prazo longo: pergunte, com leveza, se faz sentido já começar a estruturar o projeto agora.
  - Se o assistente escreveu "Ronaldo precisa avaliar" (ideia vaga ou pouco realista): não proponha reunião ainda; faça uma pergunta que ajude a entender se a ideia é viável (para quem é, como ganharia dinheiro, o que já existe).
- Mensagens como "Link: Olá! Posso ter mais informações sobre isso?" são o texto pronto do anúncio. Nunca fale de link nem diga que algo não chegou.
- Não fale de preço, a não ser que o cliente tenha perguntado; nesse caso, diga que os projetos começam a partir de R$ 20 mil e que na conversa com o especialista dá para ter o valor certo.
- Não invente nada que não esteja na conversa ou no resumo.

Responda APENAS com o texto da mensagem.`;

export async function montarContinuidade(
  supabase: SupabaseClient,
  leadId: string,
  // So para o ensaio: reconstroi o momento antes da primeira fala humana.
  ensaio?: { antesDe: string },
  // "retomada": o lead ja conversou e parou de responder (fila /followups).
  modo?: "retomada"
): Promise<{ ok?: boolean; texto?: string; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "Chave da IA não configurada." };

  let consulta = supabase
    .from("lead_messages")
    .select("direction, body, media_type, raw, created_at")
    .eq("lead_id", leadId);
  if (ensaio) consulta = consulta.lt("created_at", ensaio.antesDe);

  const [{ data: lead }, { data: msgs }] = await Promise.all([
    supabase.from("leads").select("nome, anotacoes").eq("id", leadId).single(),
    consulta.order("created_at", { ascending: false }).limit(24),
  ]);
  if (!lead) return { error: "Lead não encontrado." };

  const anotacoes = (lead.anotacoes as string | null) ?? "";
  const i = anotacoes.indexOf(INICIO_BLOCO);
  const f = anotacoes.indexOf(FIM_BLOCO);
  const resumo =
    i !== -1 && f > i ? anotacoes.slice(i + INICIO_BLOCO.length, f).trim() : "";

  const conversa = [...(msgs ?? [])]
    .reverse()
    .map((m) => {
      const quem =
        m.direction === "inbound"
          ? "Cliente"
          : m.raw && (m.raw as { bot?: boolean }).bot
            ? "Assistente automático"
            : "Ronaldo";
      const corpo = ((m.body as string | null) ?? "").trim();
      const texto = corpo || (m.media_type ? `[${m.media_type}]` : "");
      return texto ? `${quem}: ${texto.slice(0, 800)}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const agora = new Date(ensaio?.antesDe ?? Date.now()).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const pedido = [
    `Agora é ${agora} (horário de Brasília).`,
    `Nome do lead: ${(lead.nome as string) ?? "desconhecido"}.`,
    resumo ? `Resumo do assistente automático:\n${resumo}` : "Não há resumo do assistente automático.",
    `Conversa até agora (mais antiga primeiro):\n${conversa || "(sem mensagens)"}`,
    modo === "retomada"
      ? "O cliente parou de responder depois da última mensagem nossa. Escreva uma mensagem curta do Ronaldo para retomar: lembre em uma frase o ponto em que a conversa parou, com as palavras do cliente, sem cobrar resposta e sem repetir a mesma pergunta da última mensagem. Termine com uma pergunta fácil de responder (sim ou não, ou uma escolha entre duas opções). Não se apresente de novo."
      : "Escreva a próxima mensagem do Ronaldo.",
  ].join("\n\n");

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      output_config: { effort: "low" },
      // Se o modelo recusar, a API refaz no modelo de reserva.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SISTEMA,
      messages: [{ role: "user", content: pedido }],
    });

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { error: "Não consegui gerar a mensagem agora. Tente de novo." };
    }
    const texto = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!texto) return { error: "Não consegui gerar a mensagem agora. Tente de novo." };
    return { ok: true, texto };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return { error: "Limite de uso da IA atingido. Tente em alguns minutos." };
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`[continuidade] API ${e.status}`, e.message);
      return { error: "Falha ao gerar a mensagem." };
    }
    console.error("[continuidade]", e);
    return { error: "Falha ao gerar a mensagem." };
  }
}
