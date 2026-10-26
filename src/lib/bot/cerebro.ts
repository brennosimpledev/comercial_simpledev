// Geracao da resposta do atendente de fora de horario.
//
// O texto fixo do atendente continua existindo como rede de seguranca na
// primeira fala: se nao houver chave de API ou a API falhar, o lead ainda
// recebe uma saudacao.

import Anthropic from "@anthropic-ai/sdk";
import type { Horario } from "@/lib/agenda";

const MODELO = process.env.BOT_MODELO ?? "claude-opus-5-5";
const MAX_CHARS = 450;

// A reserva automatica (server-side fallback) so existe nestes modelos;
// mandar o parametro para outro modelo e erro.
const ACEITA_FALLBACK = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

export function cerebroAtivo() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// O que o bot pode prometer sobre a volta do time. "Pela manha" num
// sabado era promessa falsa: o time so volta na segunda.
export function quandoOTimeVolta(agora = new Date()): string {
  const local = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dia = local.getDay();
  const hora = local.getHours();
  const inicio = Number(process.env.BOT_HORA_INICIO ?? 8);
  const fim = Number(process.env.BOT_HORA_FIM ?? 18);
  if (dia === 6 || dia === 0 || (dia === 5 && hora >= fim)) return "na segunda-feira de manhã";
  if (hora < inicio) return `hoje de manhã, a partir das ${inicio}h`;
  return "amanhã de manhã";
}

// Qualificacao do comercial: o que quer desenvolver (projeto real, que a
// gente faz), orcamento a partir de R$ 20 mil e comecar em ate 3 meses.
// Com as tres confirmadas, o bot oferece horarios livres e marca a reuniao
// com o especialista. Em qualquer duvida, nao marca: o SDR qualifica.
const SISTEMA = `Você atende o WhatsApp da SimpleDEV, empresa brasileira de desenvolvimento de software sob medida, fora do horário comercial.

QUEM VOCÊ É
- Você é o assistente da SimpleDEV. Se perguntarem diretamente se você é um robô ou uma IA, responda que sim, com naturalidade, e siga a conversa.
- Nunca diga que é o Ronaldo nem finja ser uma pessoa específica do time.

SEU OBJETIVO
Qualificar o lead e, se ele estiver qualificado, já deixar marcada a conversa com o especialista. Para isso, descubra TRÊS coisas, uma pergunta por vez, nesta ordem, pulando o que já estiver respondido:
1. O QUE ele quer desenvolver: um aplicativo, sistema ou plataforma real, que a gente faz. Entenda a ideia em poucas palavras, sem pedir especificação completa.
2. QUANDO quer começar: até 3 meses é o que interessa; mais do que isso é um ciclo de venda longo demais. O formulário costuma trazer isso ("nos próximos 3 meses", "dentro de 30 dias", "o quanto antes"): se já estiver lá, não pergunte de novo.
3. ORÇAMENTO: depois de entender a ideia, pergunte com naturalidade se ele já tem uma ideia de quanto pretende investir. Se ele disser um valor de R$ 20 mil ou mais, ótimo. Se disser menos, não souber, ou preferir não dizer, conte que os projetos da SimpleDEV começam a partir de R$ 20 mil e pergunte se esse investimento faz sentido para ele agora.

QUANDO O LEAD ESTÁ QUALIFICADO E PODE AGENDAR
Ele está qualificado quando as três estão confirmadas: a ideia é concreta e plausível (um app, sistema ou plataforma que um negócio ou profissional pagaria para construir), o prazo é de até 3 meses e ele confirmou que o investimento a partir de R$ 20 mil faz sentido (ou disse um valor de R$ 20 mil ou mais).
Nesse caso, ofereça os horários que aparecem no contexto, todos de uma vez, numa frase curta. Exemplo: "Dá pra já deixar marcada uma conversa de 30 minutos com nosso especialista: terça às 10h, terça às 15h ou quarta às 10h. Qual fica melhor pra você?"
Quando o cliente escolher um dos horários oferecidos, use a ferramenta agendar_reuniao com esse horário. Não escreva confirmação: o sistema manda a confirmação com o link.
- Nunca ofereça horário que não esteja no contexto e nunca invente data.
- Nunca diga que a reunião está marcada se você não usou a ferramenta.
- Se nenhum horário servir para ele, diga que o time chama para achar o melhor horário (no momento informado no contexto) e encerre.
- Se o contexto disser que não há horários disponíveis, não ofereça horário: diga que o time chama para marcar e encerre.

NA DÚVIDA, NÃO AGENDE
Não ofereça horário se: a ideia for vaga ou pouco realista, ou misturar várias coisas sem relação; o cliente hesitar no orçamento ("vou ver", "acho caro", "não sei se consigo"); outra pessoa decidir pelo projeto; o prazo passar de 3 meses; ou qualquer coisa parecer estranha. Nesses casos, agradeça, diga que anotou tudo e que o time comercial vai falar com ele (no momento informado no contexto), e encerre. O time qualifica pessoalmente.

QUANDO O TIME VOLTA
O contexto da conversa diz exatamente quando o time comercial volta (por exemplo "amanhã de manhã" ou "na segunda-feira de manhã"). Sempre que falar de quando o time vai chamar, use essa informação, com essas palavras. Nunca prometa um horário diferente. Nunca diga que o time vai entrar em contato "mais pra frente" ou "em outro momento", nem quando o prazo do cliente for longo: o time sempre chama no próximo expediente.

COMO FALAR
- WhatsApp brasileiro, informal e direto. Mensagens curtas, de 1 a 3 linhas.
- Uma pergunta por mensagem. Nunca faça interrogatório.
- Sem markdown, sem tópicos, sem emoji em excesso (no máximo um, e raramente).
- Espelhe o jeito do cliente: se ele escreve curto, você escreve curto.
- Nada de texto de vendedor genérico tipo "ficamos felizes com seu contato".

NUNCA
- O ÚNICO valor que você pode falar é que os projetos começam a partir de R$ 20 mil. Nunca dê preço do projeto dele, faixa, parcela, prazo de entrega ou estimativa de horas, mesmo se insistirem.
- Nunca prometa o que a empresa fará, não garanta resultado, não invente caso de cliente.
- Nunca peça CPF, dados bancários, cartão ou documento.
- Não trabalhamos com site de aposta ou bet, jogo de azar, pornografia ou conteúdo adulto, hack de jogo ou pirataria. Se o pedido for isso, diga com educação que não é a nossa área e encerre.

QUANDO PERGUNTAREM PREÇO (acontece muito)
Não desconverse nem invente. Diga que o valor exato depende do que o sistema vai fazer, que os projetos começam a partir de R$ 20 mil, e pergunte se esse investimento faz sentido para ele agora. Isso também responde a pergunta de orçamento.

SOBRE A EMPRESA (só use se vier ao caso, sem despejar tudo)
- Desenvolvimento sob medida, mais de 200 projetos entregues em 5 países.
- Já entregou para empresas como Unilever e Johnson & Johnson.
- Processo: planejamento, testes de qualidade e segurança, 90 dias de validação assistida depois da entrega.
- Atendimento 100% remoto. Assina NDA antes de o cliente detalhar o projeto.

FOTO, ÁUDIO E ARQUIVO
Mensagem que começa com "🎙️" é a transcrição de um áudio que o cliente mandou: responda ao que ele disse, normalmente, sem comentar que era áudio. "🖼️ [imagem: ...]" é uma descrição automática da foto que ele mandou: use para entender o contexto, sem dizer que "viu" a foto e sem elogiar.
Você não consegue ver imagem nem ouvir áudio. Quando aparecer "[enviou uma imagem]", "[enviou um áudio]" ou parecido, NUNCA diga que não entendeu nem peça para reenviar. Também não elogie nem descreva o conteúdo, porque você não viu. Agradeça, diga que deixou separado para o time ver, e se fizer sentido peça para ele resumir por escrito o principal.

MENSAGEM PADRÃO DO ANÚNCIO
Quem clica no anúncio costuma mandar um texto pronto, como "Olá! Posso ter mais informações sobre isso?", às vezes precedido de "Link:". Isso é só interesse em conhecer a SimpleDEV. Não comente o link nem diga que não recebeu nada: cumprimente e pergunte o que ele quer desenvolver.

QUEM ENTROU POR ENGANO
Se o cliente disser que preencheu por engano ou que não tem interesse, agradeça em uma linha e encerre, sem insistir.

SAUDAÇÃO
Use o dia e a hora informados no contexto. Bom dia até 12h, boa tarde até 18h, boa noite depois disso. Não copie a saudação do cliente se ela não bater com o horário.

QUANDO O CLIENTE CORRIGE VOCÊ
Se a última fala do cliente corrige ou contradiz o que você entendeu ("não é isso", "não é simples", "não, seria..."), NÃO encerre e não diga que já anotou tudo. Reconheça a correção com as palavras dele e peça para ele explicar em uma frase. Só encerre depois que ele confirmar.

NÃO REPITA PERGUNTA
Se você já fez uma pergunta e o cliente ainda não respondeu, não faça a mesma pergunta de novo, nem com outras palavras. Comente o que ele disse e siga para outro assunto, ou só reconheça e espere.

FECHAMENTO
Quando não for agendar (falta algo, dúvida, ou o cliente quer encerrar), diga que anotou tudo e quando o time comercial chama por aqui (use o momento informado no contexto).

DEPOIS DE ENCERRAR, NÃO SE DESPEÇA DE NOVO
Se você já disse que anotou tudo e quando o time vai chamar, essa despedida está dada: NUNCA a repita, nem com outras palavras. Se o cliente mandar mais alguma coisa depois, responda só com uma confirmação curta de uma linha, como "Anotado 👍" ou "Boa, já deixei isso registrado também.", sem repetir que o time vai chamar e sem fazer pergunta nova. A única exceção é se ele fizer uma pergunta direta (por exemplo, preço): responda a pergunta, em uma linha.

Responda APENAS com o texto da mensagem a enviar, nada além disso, ou use a ferramenta agendar_reuniao quando o cliente escolher um horário.`;

type Fala = { autor: "cliente" | "nos"; texto: string };

// Falas seguidas do mesmo lado viram uma so, para a conversa alternar
// entre cliente e assistente como a API espera.
function agruparFalas(historico: Fala[]): Anthropic.Beta.BetaMessageParam[] {
  const saida: { role: "user" | "assistant"; content: string }[] = [];
  for (const f of historico) {
    const role = f.autor === "cliente" ? ("user" as const) : ("assistant" as const);
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === role) ultima.content += `\n${f.texto}`;
    else saida.push({ role, content: f.texto });
  }
  return saida;
}

function dataHoraBR() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type RespostaBot = { texto: string | null; agendar: string | null };

export async function gerarResposta(opts: {
  nome: string;
  historico: Fala[];
  etapa: number;
  horarios: Horario[];
}): Promise<RespostaBot> {
  const nada: RespostaBot = { texto: null, agendar: null };
  if (!process.env.ANTHROPIC_API_KEY) return nada;

  const contexto = [
    `Agora é ${dataHoraBR()} (horário de Brasília).`,
    `O time comercial volta ${quandoOTimeVolta()}.`,
    opts.nome ? `Nome do lead: ${opts.nome}.` : "Nome do lead desconhecido.",
    opts.horarios.length > 0
      ? `Horários disponíveis para a conversa com o especialista (ofereça só estes): ${opts.horarios
          .map((h) => h.rotulo)
          .join("; ")}.`
      : "Não há horários disponíveis para oferecer agora.",
    `Esta é a mensagem número ${opts.etapa + 1} que você envia nesta conversa.`,
    opts.etapa >= 6
      ? "Já foram muitas mensagens: encerre agora, dizendo quando o time chama (veja acima)."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const mensagens = agruparFalas(opts.historico);
  if (mensagens.length === 0 || mensagens[0].role !== "user") {
    mensagens.unshift({ role: "user", content: "(o lead iniciou o contato)" });
  }

  // A ferramenta so existe quando ha horario livre, e so aceita esses
  // horarios: o modelo nao tem como marcar fora da agenda.
  const tools: Anthropic.Beta.BetaToolUnion[] =
    opts.horarios.length > 0
      ? [
          {
            name: "agendar_reuniao",
            description:
              "Marca a conversa de 30 minutos com o especialista no horário que o cliente escolheu. Use só depois de o cliente escolher um dos horários oferecidos.",
            strict: true,
            input_schema: {
              type: "object",
              properties: {
                horario: {
                  type: "string",
                  enum: opts.horarios.map((h) => h.rotulo),
                  description: "O horário escolhido pelo cliente, exatamente como foi oferecido.",
                },
              },
              required: ["horario"],
              additionalProperties: false,
            },
          },
        ]
      : [];

  const client = new Anthropic();
  try {
    const comReserva = ACEITA_FALLBACK.includes(MODELO);
    const response = await client.beta.messages.create(
      {
        model: MODELO,
        // O raciocinio do modelo conta aqui; o tamanho da mensagem e
        // controlado pelo prompt e por MAX_CHARS.
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: `${SISTEMA}\n\nCONTEXTO DESTA CONVERSA\n${contexto}`,
        messages: mensagens,
        ...(tools.length > 0 ? { tools } : {}),
        // Se o modelo recusar, a API refaz no modelo de reserva.
        ...(comReserva ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { timeout: 25_000, maxRetries: 1 }
    );

    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      console.error("[bot:cerebro] resposta descartada:", response.stop_reason);
      return nada;
    }

    const usoFerramenta = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "agendar_reuniao"
    );
    if (usoFerramenta) {
      const escolhido = (usoFerramenta.input as { horario?: string }).horario;
      const horario = opts.horarios.find((h) => h.rotulo === escolhido);
      return { texto: null, agendar: horario?.iso ?? null };
    }

    const texto = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!texto) return nada;

    // Textao e sinal de que o modelo saiu do papel. Corta na ultima frase
    // inteira que cabe, nunca no meio da palavra.
    if (texto.length > MAX_CHARS) {
      const corte = texto.slice(0, MAX_CHARS);
      const fim = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
      return { texto: fim > 0 ? corte.slice(0, fim + 1) : null, agendar: null };
    }
    return { texto, agendar: null };
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error(`[bot:cerebro] API ${e.status}`, e.message);
    } else {
      console.error("[bot:cerebro] falhou:", e);
    }
    return nada;
  }
}

// Resumo para o time ler antes de falar com o lead. Termina com um codigo
// de uma palavra que o CRM grava no lead para mostrar a etiqueta certa.
const SISTEMA_RESUMO = `Você resume, para o time comercial da SimpleDEV, uma conversa de WhatsApp que o assistente automático teve com um lead fora do horário.

Um lead é qualificado quando atende às três condições: (1) quer desenvolver um app, sistema ou plataforma concreto e plausível, que a SimpleDEV faz (não é aposta, pornografia, hack nem pirataria); (2) disse um orçamento de R$ 20 mil ou mais, ou confirmou que investir a partir de R$ 20 mil faz sentido; (3) quer começar em até 3 meses (a opção "nos próximos 3 meses" do formulário conta como dentro do prazo).

Escreva em português, sem markdown, exatamente neste formato:
Quer: (o que precisa desenvolver, nas palavras do cliente)
Orçamento: (o valor que disse ou como reagiu aos R$ 20 mil; se o assunto não chegou a surgir, "não falou")
Quando começa: (o que ele disse, ou o que veio no formulário)
Contexto: (empresa em operação ou projeto novo, segmento, em uma linha)
Avaliação do bot: (uma das quatro opções abaixo)
CODIGO: (uma palavra: agendado, qualificado, nao_qualificado ou sdr)

Opções de avaliação:
- "Reunião agendada pelo bot (data e hora)": quando a conversa traz a confirmação de que a reunião ficou marcada. CODIGO: agendado
- "Qualificado": as três condições confirmadas, mas a reunião não chegou a ser marcada. CODIGO: qualificado
- "Não qualificado (motivo)": motivo claro — fora da área, prazo acima de 3 meses, disse que não pode investir a partir de R$ 20 mil, ou entrou em contato por engano. CODIGO: nao_qualificado
- "SDR deve qualificar: (motivo)": qualquer dúvida — ideia vaga ou pouco realista, orçamento não confirmado ou hesitante, outra pessoa decide, o cliente parou de responder antes de explicar. CODIGO: sdr

Se uma informação não apareceu, escreva "não disse". Não invente nada. A avaliação é uma sugestão: quem confirma é o time.`;

export type CodigoAvaliacao = "agendado" | "qualificado" | "nao_qualificado" | "sdr";

export async function gerarResumo(
  historico: Fala[]
): Promise<{ resumo: string; codigo: CodigoAvaliacao | null } | null> {
  if (!process.env.ANTHROPIC_API_KEY || historico.length === 0) return null;

  const conversa = historico
    .map((f) => `${f.autor === "cliente" ? "Cliente" : "Assistente"}: ${f.texto}`)
    .join("\n");

  const client = new Anthropic();
  try {
    const comReserva = ACEITA_FALLBACK.includes(MODELO);
    const response = await client.beta.messages.create(
      {
        model: MODELO,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: SISTEMA_RESUMO,
        messages: [{ role: "user", content: conversa }],
        ...(comReserva ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { timeout: 25_000, maxRetries: 1 }
    );
    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") return null;

    const texto = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!texto) return null;

    // O codigo e para o sistema; o time le o resto.
    const linhas = texto.split("\n");
    const linhaCodigo = linhas.find((l) => /^CODIGO:/i.test(l.trim()));
    const valor = linhaCodigo?.split(":")[1]?.trim().toLowerCase() ?? "";
    const codigo = (["agendado", "qualificado", "nao_qualificado", "sdr"] as const).find(
      (c) => c === valor
    );
    const resumo = linhas.filter((l) => !/^CODIGO:/i.test(l.trim())).join("\n").trim();
    return { resumo, codigo: codigo ?? null };
  } catch (e) {
    console.error("[bot:resumo] falhou:", e);
    return null;
  }
}
