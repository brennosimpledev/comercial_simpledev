// Um lembrete so, fora do expediente, para quem parou de responder ao bot
// no meio do atendimento: nao respondeu a pergunta ou recebeu horarios e
// nao escolheu. No fim de semana de 07-08/11/2026, 8 pessoas ficaram sem
// responder a primeira pergunta e o Paulo Marques recebeu horarios no
// sabado a tarde; ninguem falou com eles ate segunda de manha.
//
// So quando a ultima fala e uma pergunta nossa: conversa que o bot ja
// encerrou ("o time te chama na segunda") nao recebe lembrete. Uma vez por
// lead, das 7h as 22h, e nunca com gente do time na conversa.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/evolution/client";
import { botAtivo, foraDoHorario, numeroDeCliente } from "@/lib/bot/atendente";
import { horaDeChamar } from "@/lib/bot/primeiroContato";
import { primeiroNome } from "@/lib/followups/cadence";

const ESPERA_H = Number(process.env.CUTUCADA_ESPERA_H ?? 3);
// Conversa parada ha mais tempo que isso fica com o time e a regua.
const JANELA_H = 24;
const POR_RODADA = 10;

// Ligado por padrao; CUTUCADA_AUTO=0 no Vercel desliga.
export function cutucadaLigada() {
  const v = (process.env.CUTUCADA_AUTO ?? "1").toLowerCase();
  return v !== "0" && v !== "off" && v !== "false";
}

export function podeCutucarAgora(agora = new Date()) {
  if (!cutucadaLigada()) return "desligado";
  if (!botAtivo()) return "bot_desligado";
  if (!foraDoHorario(agora)) return "horario_comercial";
  if (!horaDeChamar(agora)) return "fora_da_janela_7h_22h";
  return null;
}

type Msg = { lead_id: string; direction: string; body: string | null; raw: Record<string, unknown> | null; created_at: string };

const doBot = (m: Msg) => m.direction === "outbound" && Boolean(m.raw?.bot);
const ofereceuHorario = (texto: string) => /qual fica melhor|algum desses fica bom/i.test(texto);
// A mensagem pronta do formulario nao conta como resposta ao bot.
const respostaDeVerdade = (m: Msg) => m.direction === "inbound" && !/preenchi (seu|o teu|teu) formul/i.test(m.body ?? "");

export function textoCutucada(nome: string, ultimaNossa: string, respondeuAlgo: boolean) {
  const oi = `Oi${nome ? `, ${nome}` : ""}!`;
  if (ofereceuHorario(ultimaNossa)) {
    return `${oi} Conseguiu ver os horários que te mandei? Se nenhum ficar bom, me fala o melhor dia e horário pra você que eu vejo aqui 🙂`;
  }
  if (!respondeuAlgo) {
    return `${oi} Passando só pra não deixar seu atendimento parado 🙂 Quando puder, me conta em poucas palavras o que você quer desenvolver, que eu já adianto tudo pro time comercial.`;
  }
  return `${oi} Ficou alguma dúvida? Quando puder, é só responder por aqui que eu sigo com o seu atendimento 🙂`;
}

export type PlanoCutucada = { leadId: string; nome: string | null; whatsapp: string; texto: string; ultimaNossa: string };

// Quem recebe o lembrete agora. Nao envia nada.
export async function quemCutucar(supabase: SupabaseClient, agora = new Date()) {
  const ate = new Date(agora.getTime() - ESPERA_H * 3600_000).toISOString();
  const de = new Date(agora.getTime() - JANELA_H * 3600_000).toISOString();

  // Leads com fala do bot na janela; o resto e conferido na conversa inteira.
  const { data: recentes } = await supabase
    .from("lead_messages")
    .select("lead_id")
    .eq("direction", "outbound")
    .eq("raw->>bot", "true")
    .gte("created_at", de)
    .lte("created_at", ate)
    .limit(500);
  const ids = [...new Set((recentes ?? []).map((m) => m.lead_id as string))];
  const plano: PlanoCutucada[] = [];
  const pulados: { nome: string | null; motivo: string }[] = [];
  if (ids.length === 0) return { plano, pulados };

  const [{ data: leads }, { data: reunioes }, { data: msgs }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, nome, whatsapp, estagio, status, ja_cliente, bot_pausado, desqualificado")
      .in("id", ids),
    supabase.from("meetings").select("lead_id").in("lead_id", ids),
    supabase
      .from("lead_messages")
      .select("lead_id, direction, body, raw, created_at")
      .in("lead_id", ids)
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);
  const comReuniao = new Set((reunioes ?? []).map((r) => r.lead_id as string));

  for (const lead of leads ?? []) {
    if (plano.length >= POR_RODADA) break;
    if (!lead.whatsapp || lead.ja_cliente || lead.bot_pausado || lead.desqualificado) continue;
    if (lead.status !== "ativo" || !["novo", "sdr"].includes(lead.estagio as string)) continue;
    if (comReuniao.has(lead.id as string)) continue;

    const conversa = ((msgs ?? []) as Msg[]).filter((m) => m.lead_id === lead.id);
    const ultima = conversa[conversa.length - 1];
    if (!ultima || !doBot(ultima)) continue;
    if (ultima.created_at > ate || ultima.created_at < de) continue;
    if (conversa.some((m) => m.raw?.cutucada)) continue;
    if (conversa.some((m) => m.direction === "outbound" && !m.raw?.bot)) continue;
    const texto = (ultima.body ?? "").trim();
    if (!texto.endsWith("?")) continue;

    if (await numeroDeCliente(supabase, lead.whatsapp as string)) {
      pulados.push({ nome: lead.nome as string | null, motivo: "numero_de_cliente" });
      continue;
    }
    const primeiraNossa = conversa.findIndex(doBot);
    const respondeuAlgo = conversa.slice(primeiraNossa + 1).some(respostaDeVerdade);
    plano.push({
      leadId: lead.id as string,
      nome: lead.nome as string | null,
      whatsapp: lead.whatsapp as string,
      ultimaNossa: texto,
      texto: textoCutucada(primeiroNome(lead.nome as string | null), texto, respondeuAlgo),
    });
  }
  return { plano, pulados };
}

export async function enviarCutucada(supabase: SupabaseClient, p: PlanoCutucada) {
  // Confere de novo logo antes: a pessoa pode ter respondido durante a rodada.
  const { data: ultima } = await supabase
    .from("lead_messages")
    .select("direction, raw")
    .eq("lead_id", p.leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultima || ultima.direction !== "outbound" || !(ultima.raw as Record<string, unknown> | null)?.bot) {
    return { ok: false, motivo: "conversa_andou" };
  }

  const envio = await sendWhatsAppText(p.whatsapp, p.texto);
  if (!envio.ok) return { ok: false, motivo: envio.error ?? "falha_envio" };
  await supabase.from("lead_messages").insert({
    lead_id: p.leadId,
    direction: "outbound",
    body: p.texto,
    wa_message_id: envio.waMessageId ?? null,
    status: "sent",
    raw: { bot: true, cutucada: true },
  });
  return { ok: true };
}
