// Bot de reuniao: le a resposta do cliente aos lembretes e confirma,
// remarca ou passa para o time.
//
// Quando ele age:
//   - o cliente respondeu a uma mensagem automatica (lembrete, aviso de
//     furo ou o proprio bot de reuniao);
//   - fora do horario, se ninguem do time falou na ultima hora;
//   - em horario comercial, se o cliente esta ha 20 min sem resposta do
//     time (quem chama e o cron de lembretes).
// Confirmar e na hora, a qualquer hora. Remarcar em horario comercial
// espera os 20 min do time, a nao ser que o bot ja esteja no meio da
// remarcacao (ofereceu horarios, ou mandou o aviso de furo).

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/evolution/client";
import {
  ACEITA_FALLBACK,
  MODELO,
  agruparFalas,
  cerebroAtivo,
  dataHoraBR,
  quandoOTimeVolta,
} from "@/lib/bot/cerebro";
import { foraDoHorario } from "@/lib/bot/atendente";
import { horariosLivres, remarcarPeloBot, type Horario } from "@/lib/agenda";
import { lembretesLigados, listaOu, quandoE } from "@/lib/lembretes";
import { nomeDoFormulario, primeiroNome } from "@/lib/followups/cadence";

const ESPERA_MS = Number(process.env.BOT_ESPERA_MS ?? 9000);
/** Em horario comercial, quanto o bot espera o time antes de assumir. */
export const ESPERA_TIME_MIN = 20;

export type ReuniaoEmJogo = {
  id: string;
  lead_id: string;
  starts_at: string;
  status: string;
  meet_link: string | null;
  confirmacao: string | null;
  bot_ultima_msg: string | null;
};

const CAMPOS = "id, lead_id, starts_at, status, meet_link, confirmacao, bot_ultima_msg";

/** A proxima reuniao agendada do lead, ou a que furou ha pouco e ja teve aviso. */
export async function reuniaoEmJogo(
  supabase: SupabaseClient,
  leadId: string
): Promise<ReuniaoEmJogo | null> {
  const agora = Date.now();
  const { data: proxima } = await supabase
    .from("meetings")
    .select(CAMPOS)
    .eq("lead_id", leadId)
    .eq("status", "agendada")
    .gte("starts_at", new Date(agora - 30 * 60_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (proxima) return proxima as ReuniaoEmJogo;

  const { data: furada } = await supabase
    .from("meetings")
    .select(CAMPOS)
    .eq("lead_id", leadId)
    .eq("status", "furada")
    .not("aviso_furo_em", "is", null)
    .gte("starts_at", new Date(agora - 4 * 86_400_000).toISOString())
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (furada as ReuniaoEmJogo | null) ?? null;
}

type Msg = {
  direction: string;
  created_at: string;
  body: string | null;
  media_type: string | null;
  wa_message_id: string | null;
  raw: Record<string, unknown> | null;
};

const automatica = (m: Msg) =>
  m.direction === "outbound" && Boolean(m.raw && ((m.raw as { bot?: boolean }).bot || (m.raw as { lembrete?: string }).lembrete));

function textoDaFala(m: Msg) {
  const corpo = (m.body ?? "").trim();
  if (corpo) return corpo.slice(0, 800);
  return m.media_type ? `[enviou ${m.media_type}]` : "";
}

const SISTEMA = `Você é o assistente da SimpleDEV (desenvolvimento de software sob medida) no WhatsApp, e cuida SÓ da reunião que o cliente já tem marcada com o especialista: confirmar presença e remarcar.

O QUE FAZER (sempre use exatamente uma ferramenta)
- O cliente confirmou (sim, confirmado, estarei lá, ok, 👍...): use confirmar_presenca com uma resposta curta e calorosa, repetindo o dia e a hora.
- O cliente quer outro horário, não vai conseguir, pede para mudar, ou a reunião furou e ele quer remarcar: use oferecer_horarios com uma mensagem curta que ofereça os horários disponíveis do contexto (todos, com as mesmas palavras) e pergunte qual fica melhor. Não ofereça horário que não esteja na lista.
- O cliente escolheu um dos horários oferecidos (ou pediu exatamente um deles): use remarcar_reuniao com esse horário.
- O cliente pediu um horário que não está na lista: use oferecer_horarios dizendo que esse não está livre e ofereça os da lista.
- Não há horários disponíveis e ele quer remarcar: use passar_para_o_time, motivo "outro", com um texto dizendo que o time vai combinar o melhor horário com ele.
- Ele quer cancelar ou desistiu da reunião: use passar_para_o_time, motivo "cancelar". Não insista e não tente convencer.
- Qualquer outro assunto (dúvida sobre o projeto, preço, documento, conversa com o vendedor): use passar_para_o_time, motivo "outro", com texto vazio. Quem responde é o time.

COMO FALAR
- WhatsApp brasileiro, informal e direto. De 1 a 3 linhas. No máximo um emoji. Sem markdown.
- Nunca fale de preço nem prometa nada sobre o projeto.
- Quando o texto de passar_para_o_time não for vazio e o time estiver fora do expediente, diga quando o time chama (use o momento informado no contexto).`;

type Decisao =
  | { tipo: "confirmar"; texto: string }
  | { tipo: "oferecer"; texto: string }
  | { tipo: "remarcar"; iso: string }
  | { tipo: "time"; motivo: "cancelar" | "outro"; texto: string };

export async function decidirSobreReuniao(opts: {
  nome: string;
  historico: { autor: "cliente" | "nos"; texto: string }[];
  reuniao: ReuniaoEmJogo;
  horarios: Horario[];
}): Promise<Decisao | null> {
  const r = opts.reuniao;
  const contexto = [
    `Agora é ${dataHoraBR()} (horário de Brasília).`,
    foraDoHorario()
      ? `O time comercial está fora do expediente e volta ${quandoOTimeVolta()}.`
      : "O time comercial está no expediente.",
    opts.nome ? `Nome do cliente: ${opts.nome}.` : "Nome do cliente desconhecido.",
    r.status === "furada"
      ? `A reunião estava marcada para ${quandoE(new Date(r.starts_at))} e o cliente não apareceu (furou).`
      : `A reunião está marcada para ${quandoE(new Date(r.starts_at))}.`,
    r.confirmacao === "confirmada" ? "O cliente já tinha confirmado presença." : "",
    opts.horarios.length > 0
      ? `Horários disponíveis para remarcar (ofereça só estes): ${listaOu(opts.horarios.map((h) => h.rotulo))}.`
      : "Não há horários disponíveis para remarcar agora.",
  ]
    .filter(Boolean)
    .join("\n");

  const tools: Anthropic.Beta.BetaToolUnion[] = [
    {
      name: "confirmar_presenca",
      description: "O cliente confirmou que vai à reunião.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { texto: { type: "string", description: "Resposta curta ao cliente." } },
        required: ["texto"],
        additionalProperties: false,
      },
    },
    {
      name: "passar_para_o_time",
      description: "O assunto não é confirmar nem remarcar, o cliente quer cancelar, ou não há horário para oferecer.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          motivo: { type: "string", enum: ["cancelar", "outro"] },
          texto: { type: "string", description: "Resposta curta ao cliente, ou vazio para não responder." },
        },
        required: ["motivo", "texto"],
        additionalProperties: false,
      },
    },
  ];
  if (opts.horarios.length > 0) {
    tools.push(
      {
        name: "oferecer_horarios",
        description: "Oferece os horários disponíveis para remarcar.",
        strict: true,
        input_schema: {
          type: "object",
          properties: { texto: { type: "string", description: "Mensagem oferecendo os horários." } },
          required: ["texto"],
          additionalProperties: false,
        },
      },
      {
        name: "remarcar_reuniao",
        description: "Remarca a reunião para o horário que o cliente escolheu entre os oferecidos.",
        strict: true,
        input_schema: {
          type: "object",
          properties: {
            horario: { type: "string", enum: opts.horarios.map((h) => h.rotulo) },
          },
          required: ["horario"],
          additionalProperties: false,
        },
      }
    );
  }

  const client = new Anthropic();
  try {
    const comReserva = ACEITA_FALLBACK.includes(MODELO);
    const response = await client.beta.messages.create(
      {
        model: MODELO,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: `${SISTEMA}\n\nCONTEXTO\n${contexto}`,
        messages: agruparFalas(opts.historico),
        tools,
        ...(comReserva ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { timeout: 25_000, maxRetries: 1 }
    );
    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") return null;

    const uso = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use"
    );
    if (!uso) return null;
    const entrada = uso.input as { texto?: string; motivo?: string; horario?: string };
    switch (uso.name) {
      case "confirmar_presenca":
        return { tipo: "confirmar", texto: (entrada.texto ?? "").trim() };
      case "oferecer_horarios":
        return { tipo: "oferecer", texto: (entrada.texto ?? "").trim() };
      case "remarcar_reuniao": {
        const h = opts.horarios.find((x) => x.rotulo === entrada.horario);
        return h ? { tipo: "remarcar", iso: h.iso } : null;
      }
      case "passar_para_o_time":
        return {
          tipo: "time",
          motivo: entrada.motivo === "cancelar" ? "cancelar" : "outro",
          texto: (entrada.texto ?? "").trim(),
        };
    }
    return null;
  } catch (e) {
    console.error("[bot:reuniao] falhou:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
}

async function enviar(
  supabase: SupabaseClient,
  lead: { id: string; whatsapp: string },
  reuniaoId: string,
  texto: string,
  acao: string
) {
  const envio = await sendWhatsAppText(lead.whatsapp, texto);
  if (!envio.ok) {
    console.error("[bot:reuniao] falha ao enviar:", envio.error);
    return false;
  }
  await supabase.from("lead_messages").insert({
    lead_id: lead.id,
    direction: "outbound",
    body: texto,
    status: "sent",
    wa_message_id: envio.waMessageId ?? null,
    raw: { bot: true, reuniao: reuniaoId, acao },
  });
  return true;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Trata a ultima mensagem do cliente sobre a reuniao. Nunca lanca.
 * `origem` "cron" e o caminho dos 20 min sem resposta do time.
 */
export async function atenderReuniao(
  supabase: SupabaseClient,
  leadId: string,
  opts: { gatilho?: string | null; origem: "webhook" | "cron"; ensaio?: boolean }
): Promise<{ agiu: boolean; motivo: string; decisao?: Decisao }> {
  try {
    if (!lembretesLigados() && !opts.ensaio) return { agiu: false, motivo: "lembretes_desligados" };
    if (!cerebroAtivo()) return { agiu: false, motivo: "sem_ia" };

    const reuniao = await reuniaoEmJogo(supabase, leadId);
    if (!reuniao) return { agiu: false, motivo: "sem_reuniao" };

    const { data: lead } = await supabase
      .from("leads")
      .select("id, nome, whatsapp, bot_pausado")
      .eq("id", leadId)
      .single();
    if (!lead?.whatsapp) return { agiu: false, motivo: "sem_whatsapp" };
    if (lead.bot_pausado) return { agiu: false, motivo: "bot_pausado" };

    if (opts.origem === "webhook") await espera(ESPERA_MS);

    const { data } = await supabase
      .from("lead_messages")
      .select("direction, created_at, body, media_type, wa_message_id, raw")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(30);
    const lista = (data ?? []) as Msg[];
    const ultima = lista[0];
    if (!ultima || ultima.direction !== "inbound") return { agiu: false, motivo: "nada_novo" };
    if (opts.gatilho && ultima.wa_message_id !== opts.gatilho) {
      return { agiu: false, motivo: "cliente_ainda_escrevendo" };
    }
    const idUltima = ultima.wa_message_id ?? ultima.created_at;
    if (reuniao.bot_ultima_msg === idUltima && !opts.ensaio) return { agiu: false, motivo: "ja_avaliada" };
    if (!(ultima.body ?? "").trim() && (!ultima.media_type || ultima.media_type === "sticker")) {
      return { agiu: false, motivo: "mensagem_sem_conteudo" };
    }

    // Quem falou por ultimo do nosso lado.
    const nossa = lista.find((m) => m.direction === "outbound");
    const respondendoAoBot = Boolean(nossa && automatica(nossa));
    const humanoNaUltimaHora = lista.some(
      (m) => m.direction === "outbound" && !automatica(m) && Date.now() - new Date(m.created_at).getTime() < 3600_000
    );
    const minutosSemResposta = (Date.now() - new Date(ultima.created_at).getTime()) / 60_000;

    const podeAgir =
      respondendoAoBot ||
      (opts.origem === "webhook" && foraDoHorario() && !humanoNaUltimaHora) ||
      (opts.origem === "cron" && minutosSemResposta >= ESPERA_TIME_MIN);
    if (!podeAgir) return { agiu: false, motivo: "conversa_do_time" };

    // O bot ja esta conduzindo a remarcacao: continua a qualquer hora.
    const naRemarcacao = Boolean(
      nossa &&
        nossa.raw &&
        ((nossa.raw as { acao?: string }).acao === "oferecer" ||
          (nossa.raw as { lembrete?: string }).lembrete === "furo")
    );

    const historico = [...lista]
      .slice(0, 16)
      .reverse()
      .map((m) => ({
        autor: m.direction === "inbound" ? ("cliente" as const) : ("nos" as const),
        texto: textoDaFala(m),
      }))
      .filter((f) => f.texto);
    // A conversa precisa comecar pelo cliente para a API.
    while (historico.length && historico[0].autor !== "cliente") historico.shift();
    if (historico.length === 0) return { agiu: false, motivo: "sem_historico" };

    const { data: entradas } = await supabase
      .from("lead_messages")
      .select("direction, body")
      .eq("lead_id", leadId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: true })
      .limit(5);
    const nome = primeiroNome(nomeDoFormulario((entradas ?? []) as { direction: string; body: string | null }[]));

    const horarios = await horariosLivres(supabase);
    const decisao = await decidirSobreReuniao({ nome, historico, reuniao, horarios });
    if (!decisao) return { agiu: false, motivo: "ia_falhou" };
    if (opts.ensaio) return { agiu: false, motivo: "ensaio", decisao };

    // Remarcar em horario comercial: o time tem 20 min para assumir.
    const ehRemarcacao = decisao.tipo === "oferecer" || decisao.tipo === "remarcar";
    if (
      ehRemarcacao &&
      opts.origem === "webhook" &&
      !foraDoHorario() &&
      !naRemarcacao
    ) {
      await supabase
        .from("meetings")
        .update({ confirmacao: "remarcar", confirmacao_em: new Date().toISOString() })
        .eq("id", reuniao.id);
      return { agiu: false, motivo: "aguardando_time", decisao };
    }

    await supabase.from("meetings").update({ bot_ultima_msg: idUltima }).eq("id", reuniao.id);
    const alvo = { id: lead.id as string, whatsapp: lead.whatsapp as string };
    const agora = new Date().toISOString();

    if (decisao.tipo === "confirmar") {
      await supabase
        .from("meetings")
        .update({ confirmacao: "confirmada", confirmacao_em: agora })
        .eq("id", reuniao.id);
      if (decisao.texto) await enviar(supabase, alvo, reuniao.id, decisao.texto, "confirmar");
      return { agiu: true, motivo: "confirmou", decisao };
    }

    if (decisao.tipo === "oferecer") {
      if (reuniao.status === "agendada") {
        await supabase
          .from("meetings")
          .update({ confirmacao: "remarcar", confirmacao_em: agora })
          .eq("id", reuniao.id);
      }
      await enviar(supabase, alvo, reuniao.id, decisao.texto, "oferecer");
      return { agiu: true, motivo: "ofereceu_horarios", decisao };
    }

    if (decisao.tipo === "remarcar") {
      const feito = await remarcarPeloBot(supabase, reuniao.id, decisao.iso);
      if (feito.ok) {
        // Escolheu o horario agora: ja conta como confirmada.
        await supabase
          .from("meetings")
          .update({ confirmacao: "confirmada", confirmacao_em: agora, bot_ultima_msg: idUltima })
          .eq("id", reuniao.id);
        const texto =
          `Prontinho${nome ? `, ${nome}` : ""}! Remarquei nossa conversa para ${quandoE(feito.inicio)}.` +
          (feito.meetLink ? `\n\nO link do Google Meet continua o mesmo: ${feito.meetLink}` : "");
        await enviar(supabase, alvo, reuniao.id, texto, "remarcou");
        return { agiu: true, motivo: "remarcou", decisao };
      }
      console.error("[bot:reuniao] remarcacao falhou:", feito.motivo);
      const outros = (await horariosLivres(supabase)).filter((h) => h.iso !== decisao.iso);
      const texto =
        outros.length > 0
          ? `Esse horário acabou de ser ocupado 😕 Tenho ${listaOu(outros.map((h) => h.rotulo))}. Algum desses fica bom pra você?`
          : `Esse horário acabou de ser ocupado 😕 O time comercial te chama ${foraDoHorario() ? quandoOTimeVolta() : "em instantes"} pra achar o melhor horário com você.`;
      await enviar(supabase, alvo, reuniao.id, texto, outros.length > 0 ? "oferecer" : "falhou");
      return { agiu: true, motivo: "remarcacao_falhou", decisao };
    }

    // Passa para o time: cancelamento vira etiqueta; em horario comercial
    // o bot fica quieto e o time responde.
    if (decisao.motivo === "cancelar") {
      await supabase
        .from("meetings")
        .update({ confirmacao: "cancelar", confirmacao_em: agora })
        .eq("id", reuniao.id);
    }
    if (decisao.texto && foraDoHorario()) {
      await enviar(supabase, alvo, reuniao.id, decisao.texto, "time");
    }
    return { agiu: true, motivo: `time_${decisao.motivo}`, decisao };
  } catch (e) {
    console.error("[bot:reuniao]", e);
    return { agiu: false, motivo: "erro" };
  }
}
