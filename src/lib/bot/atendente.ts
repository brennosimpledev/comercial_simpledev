// Atendente de fora de horario - FASE 1.
//
// Regra de ouro: o bot so fala DEPOIS que o lead falou. Ele nunca inicia
// conversa, nunca varre a base, nunca dispara em lote. Se o webhook nao
// receber mensagem do cliente, nada acontece.
//
// E o bot so cuida do PRIMEIRO atendimento: lead que ja conversou com
// alguem do time, que tem reuniao ou que ja saiu do estagio de SDR e
// conversa de gente. Na primeira semana ele atropelou um cliente fechando
// contrato e outro com reuniao marcada; nao pode acontecer de novo.
//
// Fase 1: conversa, colhe o projeto, avisa que o time retorna de manha e
// deixa um resumo nas anotacoes do lead. Nao agenda reuniao.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/evolution/client";
import {
  cerebroAtivo,
  gerarResposta,
  gerarResumo,
  quandoOTimeVolta,
  type CodigoAvaliacao,
} from "@/lib/bot/cerebro";
import { agendarPeloBot, horariosLivres, rotuloHorario } from "@/lib/agenda";
import { brCanonical, last8 } from "@/lib/phone";

const TZ = "America/Sao_Paulo";

// Desligado por padrao: so roda quando BOT_FASE1 estiver ligado no Vercel.
export function botAtivo() {
  const v = (process.env.BOT_FASE1 ?? "").toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

// O Ronaldo ja esta no WhatsApp antes das 8h; comecar as 9h fazia o bot
// responder por cima dele.
const HORA_INICIO = Number(process.env.BOT_HORA_INICIO ?? 8);
const HORA_FIM = Number(process.env.BOT_HORA_FIM ?? 18);

// Teto por lead. Qualificar as tres coisas e marcar a reuniao pede algumas
// trocas a mais que so colher a ideia.
const MAX_MENSAGENS = Number(process.env.BOT_MAX_MENSAGENS ?? 8);

// Nome do arquivo, legenda ou descricao da foto que indica pagamento.
const COMPROVANTE = /comprovante|recibo|\bpix\b|pagamento|transfer[eê]ncia|boleto/i;

// Quanto esperar o cliente terminar de escrever antes de responder. Quem
// manda tres mensagens seguidas recebe uma resposta so, para as tres.
const ESPERA_MS = Number(process.env.BOT_ESPERA_MS ?? 9000);

// Cliente que escreve poucos segundos depois da nossa mensagem escreveu
// antes de le-la. Responder na hora faz o bot repetir a pergunta que o
// cliente esta prestes a responder; melhor esperar mais um pouco.
const JANELA_CRUZADA_MS = 8000;
const ESPERA_CRUZADA_MS = Number(process.env.BOT_ESPERA_CRUZADA_MS ?? 15000);

// So estes estagios sao territorio do bot.
const ESTAGIOS_DO_BOT = ["novo", "sdr"];

// O mesmo WhatsApp atende o financeiro de quem ja fechou. Se QUALQUER
// cadastro com este numero ja for cliente, o bot nao fala - inclusive
// quando o lead foi duplicado e o card fechado nao e o que recebe as
// mensagens (aconteceu com um cliente fechado em 19/10).
async function numeroDeCliente(supabase: SupabaseClient, whatsapp: string) {
  const { data } = await supabase
    .from("leads")
    .select("whatsapp, estagio, status, ja_cliente, valor_fechado")
    .like("whatsapp_digits", `%${last8(whatsapp)}`)
    .limit(10);
  const canon = brCanonical(whatsapp);
  return (data ?? []).some(
    (l) =>
      brCanonical(l.whatsapp as string | null) === canon &&
      (l.ja_cliente ||
        l.status === "ganho" ||
        l.estagio === "fechado" ||
        Number(l.valor_fechado ?? 0) > 0)
  );
}

export function foraDoHorario(agora = new Date()) {
  const local = new Date(agora.toLocaleString("en-US", { timeZone: TZ }));
  const dia = local.getDay();
  const hora = local.getHours();
  if (dia === 0 || dia === 6) return true;
  return hora < HORA_INICIO || hora >= HORA_FIM;
}

// Rede de seguranca para quando a IA falha, so na primeira fala. Depois
// disso o bot fica quieto: texto fixo no meio da conversa repetia pergunta
// ou despedida.
const ABERTURA = (nome: string) =>
  `Oi${nome ? `, ${nome}` : ""}! Aqui é o assistente da SimpleDEV.\n` +
  `O time comercial já está fora do expediente, mas eu adianto o seu atendimento pra não te deixar esperando.\n\n` +
  `Me conta rapidinho: o que você precisa desenvolver?`;

type Mensagem = {
  direction: string;
  created_at: string;
  raw: Record<string, unknown> | null;
  body?: string | null;
  media_type?: string | null;
  wa_message_id?: string | null;
};

function ehDoBot(m: Mensagem) {
  return Boolean(m.raw && (m.raw as { bot?: boolean }).bot);
}

const NOME_MIDIA: Record<string, string> = {
  image: "uma imagem",
  imagem: "uma imagem",
  audio: "um áudio",
  video: "um vídeo",
  document: "um documento",
  documento: "um documento",
  sticker: "uma figurinha",
};

function textoDaFala(m: Mensagem) {
  const corpo = (m.body ?? "").trim();
  if (corpo) return corpo.slice(0, 1200);
  if (m.media_type) {
    return `[enviou ${NOME_MIDIA[m.media_type] ?? "um arquivo"}]`;
  }
  return "";
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Responde o lead quando for o caso. Nunca lanca: roda depois da resposta
 * do webhook e nao pode derrubar nada.
 *
 * `gatilho` e o wa_message_id da mensagem que acordou o bot. Depois da
 * espera, se chegou mensagem mais nova do cliente, este disparo desiste e
 * deixa o da mensagem nova responder por todas.
 */
export async function responderForaDeHorario(
  supabase: SupabaseClient,
  leadId: string,
  gatilho?: string | null
): Promise<{ enviou: boolean; motivo?: string }> {
  try {
    if (!botAtivo()) return { enviou: false, motivo: "bot_desligado" };
    if (!foraDoHorario()) return { enviou: false, motivo: "horario_comercial" };

    const { data: lead } = await supabase
      .from("leads")
      .select("id, nome, whatsapp, bot_pausado, ja_cliente, estagio, status, anotacoes")
      .eq("id", leadId)
      .single();
    if (!lead?.whatsapp) return { enviou: false, motivo: "sem_whatsapp" };
    if (lead.bot_pausado) return { enviou: false, motivo: "bot_pausado" };
    if (lead.ja_cliente) return { enviou: false, motivo: "ja_cliente" };
    if (lead.status === "ganho") return { enviou: false, motivo: "cliente_fechado" };
    if (!ESTAGIOS_DO_BOT.includes(lead.estagio as string)) {
      return { enviou: false, motivo: "fora_do_estagio_do_bot" };
    }

    const { count: reunioes } = await supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId);
    if ((reunioes ?? 0) > 0) return { enviou: false, motivo: "tem_reuniao" };

    // Qualquer fala humana, em qualquer momento, tira o bot da conversa.
    const { count: falasHumanas } = await supabase
      .from("lead_messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("direction", "outbound")
      .or("raw.is.null,raw->>bot.is.null");
    if ((falasHumanas ?? 0) > 0) return { enviou: false, motivo: "ja_atendido_por_humano" };

    if (await numeroDeCliente(supabase, lead.whatsapp as string)) {
      return { enviou: false, motivo: "numero_de_cliente" };
    }

    // Espera o cliente terminar de escrever.
    await espera(ESPERA_MS);

    const { data: msgs } = await supabase
      .from("lead_messages")
      .select("direction, created_at, raw, body, media_type, wa_message_id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(40);

    const lista = (msgs ?? []) as Mensagem[];
    const ultima = lista[0];

    // Chegou mensagem nova depois desta: quem responde e o disparo dela.
    if (gatilho && ultima?.direction === "inbound" && ultima.wa_message_id !== gatilho) {
      return { enviou: false, motivo: "cliente_ainda_escrevendo" };
    }
    // A ultima fala ja e nossa: nao ha nada novo para responder.
    if (!ultima || ultima.direction !== "inbound") {
      return { enviou: false, motivo: "nada_novo" };
    }
    // Reacao, figurinha ou mensagem sem conteudo nao pede resposta. Antes,
    // o bot tentava responder a nada, a IA falhava e saia uma segunda
    // despedida pelo texto fixo.
    const semConteudo =
      !(ultima.body ?? "").trim() &&
      (!ultima.media_type || ultima.media_type === "sticker");
    if (semConteudo) {
      return { enviou: false, motivo: "mensagem_sem_conteudo" };
    }
    // Humano entrou durante a espera.
    if (lista.some((m) => m.direction === "outbound" && !ehDoBot(m))) {
      return { enviou: false, motivo: "ja_atendido_por_humano" };
    }

    const doBot = lista.filter((m) => m.direction === "outbound" && ehDoBot(m));
    if (doBot.length >= MAX_MENSAGENS) {
      return { enviou: false, motivo: "teto_de_mensagens" };
    }

    // Mensagens cruzadas: o cliente mandou isto logo depois da nossa
    // pergunta, sem ter lido. Espera mais um pouco; se ele responder a
    // pergunta nesse meio tempo, o disparo da resposta dele fala por tudo.
    const nossaUltima = lista.find((m) => m.direction === "outbound");
    if (
      gatilho &&
      nossaUltima &&
      new Date(ultima.created_at).getTime() -
        new Date(nossaUltima.created_at).getTime() <
        JANELA_CRUZADA_MS
    ) {
      await espera(ESPERA_CRUZADA_MS);
      const { data: maisNova } = await supabase
        .from("lead_messages")
        .select("direction, wa_message_id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maisNova?.wa_message_id !== ultima.wa_message_id) {
        return { enviou: false, motivo: "cliente_ainda_escrevendo" };
      }
    }

    const etapa = doBot.length;
    const primeiroNome = (lead.nome ?? "").trim().split(/\s+/)[0] ?? "";
    // Nome generico de numero desconhecido nao vira saudacao.
    const nome = /whatsapp/i.test(primeiroNome) ? "" : primeiroNome;

    const historico = [...lista]
      .reverse()
      .map((m) => ({
        autor: m.direction === "inbound" ? ("cliente" as const) : ("nos" as const),
        texto: textoDaFala(m),
      }))
      .filter((f) => f.texto)
      .slice(-14);

    // A conversa precisa terminar com o cliente: se a ultima fala com
    // conteudo e nossa, a API trata como resposta pela metade e recusa.
    if (historico.length === 0 || historico[historico.length - 1].autor !== "cliente") {
      return { enviou: false, motivo: "nada_novo_para_responder" };
    }

    // Arquivo sozinho nao e conversa de venda. Comprovante de pagamento vem
    // de quem ja e cliente (em 26/10 o bot respondeu um com "o que voce
    // quer desenvolver?"): so agradece e sai da conversa. Outro arquivo sem
    // texto na abertura: avisa que vai olhar, sem pergunta de venda.
    const iNossa = lista.findIndex((m) => m.direction === "outbound");
    const turno = iNossa === -1 ? lista : lista.slice(0, iNossa);
    const temArquivo = turno.some((m) => m.media_type === "document" || m.media_type === "image");
    const comprovante = temArquivo && turno.some((m) => COMPROVANTE.test(m.body ?? ""));
    const soArquivo = turno.length > 0 && turno.every((m) => m.media_type === "document");

    let texto: string | null = null;
    let viaIa = false;
    let agendouEm: string | null = null;
    if (comprovante) {
      texto = "Recebido, obrigado!";
    } else if (soArquivo && etapa === 0) {
      texto = "Opa, recebi! Vou dar uma olhada aqui.";
    } else if (cerebroAtivo()) {
      // Horarios livres de verdade: agenda do Google, reunioes do CRM e
      // bloqueios. Sem conseguir ler a agenda, a lista vem vazia e o bot
      // nao oferece horario.
      const horarios = await horariosLivres(supabase);
      const resposta = await gerarResposta({ nome, historico, etapa, horarios });
      texto = resposta.texto;
      viaIa = Boolean(texto);

      if (resposta.agendar) {
        const marcado = await agendarPeloBot(supabase, leadId, resposta.agendar);
        if (marcado.ok) {
          agendouEm = marcado.inicio.toISOString();
          texto =
            `Prontinho${nome ? `, ${nome}` : ""}! Sua conversa com nosso especialista ficou marcada para ${rotuloHorario(marcado.inicio)}.` +
            (marcado.meetLink ? `\n\nLink do Google Meet: ${marcado.meetLink}` : "") +
            `\n\nSe surgir algum imprevisto, é só avisar por aqui.`;
        } else {
          console.error("[bot] agendamento falhou:", marcado.motivo);
          // O horario foi ocupado desde a oferta (ou a agenda falhou): oferece
          // o que sobrou ou devolve para o time.
          const outros = (await horariosLivres(supabase)).filter((h) => h.iso !== resposta.agendar);
          texto =
            outros.length > 0
              ? `Esse horário acabou de ser ocupado 😕 Tenho ${outros
                  .map((h) => h.rotulo)
                  .join(" ou ")}. Algum desses fica bom pra você?`
              : `Esse horário acabou de ser ocupado 😕 O time comercial te chama ${quandoOTimeVolta()} pra achar o melhor horário com você.`;
        }
        viaIa = true;
      }
    }
    if (!texto) {
      // Texto fixo so na primeira fala. No meio da conversa ele repetia
      // pergunta ou despedida; ficar calado e melhor, o time assume logo.
      if (etapa === 0) texto = ABERTURA(nome);
      else return { enviou: false, motivo: "ia_falhou_no_meio_da_conversa" };
    }

    // A IA leva alguns segundos. Se nesse tempo o cliente escreveu de novo
    // ou alguem respondeu, esta resposta ja esta velha: quem fala e o
    // disparo da mensagem nova, com a conversa inteira.
    const { data: antesDeEnviar } = await supabase
      .from("lead_messages")
      .select("wa_message_id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (antesDeEnviar?.wa_message_id !== ultima.wa_message_id) {
      return { enviou: false, motivo: "conversa_andou_durante_a_ia" };
    }

    const envio = await sendWhatsAppText(lead.whatsapp, texto);
    if (!envio.ok) {
      console.error("[bot] falha ao enviar:", envio.error);
      return { enviou: false, motivo: "falha_envio" };
    }

    await supabase.from("lead_messages").insert({
      lead_id: leadId,
      direction: "outbound",
      body: texto,
      status: "sent",
      wa_message_id: envio.waMessageId ?? null,
      raw: {
        bot: true,
        etapa: etapa + 1,
        fase: 2,
        ia: viaIa,
        ...(agendouEm ? { agendou: agendouEm } : {}),
        ...(comprovante ? { comprovante: true } : {}),
      },
    });

    if (comprovante) {
      // Pausar o bot tambem cancela a regua de follow-up desse numero.
      await supabase.from("leads").update({ bot_pausado: true }).eq("id", leadId);
      await gravarBloco(
        supabase,
        leadId,
        (lead.anotacoes as string | null) ?? "",
        "Mandou um comprovante de pagamento. O bot só agradeceu e foi pausado para este lead.\nAvaliação do bot: provável cliente. Confira e marque como cliente se for o caso.",
        null
      );
      return { enviou: true };
    }

    await atualizarResumo(supabase, leadId, (lead.anotacoes as string | null) ?? "", [
      ...historico,
      { autor: "nos" as const, texto },
    ]);

    return { enviou: true };
  } catch (e) {
    console.error("[bot] responderForaDeHorario:", e);
    return { enviou: false, motivo: "erro" };
  }
}

// O resumo fica num bloco proprio dentro das anotacoes: o bot reescreve so
// esse trecho e nunca toca no que o time escreveu.
const INICIO_BLOCO = "--- Atendimento do bot ---";
const FIM_BLOCO = "--- fim do resumo do bot ---";

async function atualizarResumo(
  supabase: SupabaseClient,
  leadId: string,
  anotacoes: string,
  historico: { autor: "cliente" | "nos"; texto: string }[]
) {
  const gerado = await gerarResumo(historico);
  if (!gerado) return;

  // Quem nao respondeu nada depois da primeira mensagem do bot nao e caso
  // de "SDR qualificar": essa etiqueta saiu em todos os leads da semana de
  // 26/10 e deixou de dizer alguma coisa.
  const iPrimeira = historico.findIndex((f) => f.autor === "nos");
  const respondeu = iPrimeira !== -1 && historico.slice(iPrimeira + 1).some((f) => f.autor === "cliente");
  const codigo = respondeu ? gerado.codigo : "sem_resposta";

  await gravarBloco(supabase, leadId, anotacoes, gerado.resumo, codigo);
}

async function gravarBloco(
  supabase: SupabaseClient,
  leadId: string,
  anotacoes: string,
  resumo: string,
  codigo: CodigoAvaliacao | null
) {
  const quando = new Date().toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bloco = `${INICIO_BLOCO}\n(${quando})\n${resumo}\n${FIM_BLOCO}`;

  const i = anotacoes.indexOf(INICIO_BLOCO);
  const f = anotacoes.indexOf(FIM_BLOCO);
  const novas =
    i !== -1 && f !== -1 && f > i
      ? anotacoes.slice(0, i) + bloco + anotacoes.slice(f + FIM_BLOCO.length)
      : anotacoes.trim()
        ? `${bloco}\n\n${anotacoes.trim()}`
        : bloco;

  await supabase.from("leads").update({ anotacoes: novas }).eq("id", leadId);

  // Etiqueta do lead na lista ("SDR qualificar", "agendado pelo bot"...).
  // Update separado: sem a migration 0018 a coluna nao existe e isso nao
  // pode impedir o resumo de ser gravado.
  if (codigo) {
    await supabase.from("leads").update({ bot_avaliacao: codigo }).eq("id", leadId);
  }
}
