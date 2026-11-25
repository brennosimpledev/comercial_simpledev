// Rede de seguranca do atendente de fora de horario.
//
// O bot responde dentro do proprio aviso do WhatsApp (after() do webhook).
// Se aquela execucao morre no meio (tempo esgotado, IA fora, falha de
// envio), ninguem tenta de novo e o lead fica falando sozinho ate o time
// voltar. Aconteceu em 24/11/2026 as 19:36: um lead escreveu, o card do
// formulario foi juntado com a conversa e o bot nao respondeu; o lead do
// minuto anterior foi atendido normalmente.
//
// Aqui: quem escreveu fora do expediente, tem a ultima fala da conversa e
// esta sem resposta ha alguns minutos recebe uma nova tentativa do mesmo
// atendente, com todas as travas dele (humano na conversa, reuniao,
// cliente, teto de mensagens...). Roda junto com a cutucada, a cada 15 min.

import type { SupabaseClient } from "@supabase/supabase-js";
import { botAtivo, foraDoHorario, responderForaDeHorario } from "@/lib/bot/atendente";

// Da tempo de o disparo normal responder (espera + IA) antes de insistir.
const DEPOIS_DE_MIN = 4;
// Mensagem mais velha que isso fica para o time: resposta de bot muito
// tempo depois, de madrugada, mais atrapalha do que ajuda.
const ATE_MIN = 45;
const POR_RODADA = 2;

export async function semRespostaDoBot(supabase: SupabaseClient, agora = new Date()) {
  const de = new Date(agora.getTime() - ATE_MIN * 60_000).toISOString();
  const ate = new Date(agora.getTime() - DEPOIS_DE_MIN * 60_000).toISOString();
  const { data: recentes } = await supabase
    .from("lead_messages")
    .select("lead_id")
    .eq("direction", "inbound")
    .gte("created_at", de)
    .lte("created_at", ate)
    .limit(300);
  const ids = [...new Set((recentes ?? []).map((m) => m.lead_id as string))];
  if (ids.length === 0) return [];
  const { data: leads } = await supabase
    .from("leads")
    .select("id, nome")
    .in("id", ids)
    .in("estagio", ["novo", "sdr"])
    .eq("status", "ativo")
    .eq("bot_pausado", false)
    .eq("ja_cliente", false);

  const parados: { id: string; nome: string | null; desde: string }[] = [];
  for (const l of leads ?? []) {
    const { data: ultima } = await supabase
      .from("lead_messages")
      .select("direction, created_at")
      .eq("lead_id", l.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima?.direction === "inbound" && (ultima.created_at as string) <= ate) {
      parados.push({ id: l.id as string, nome: l.nome as string | null, desde: ultima.created_at as string });
    }
  }
  return parados;
}

export function podeResgatarAgora(agora = new Date()) {
  if (!botAtivo()) return "bot_desligado";
  if (!foraDoHorario(agora)) return "horario_comercial";
  return null;
}

export async function resgatar(supabase: SupabaseClient, agora = new Date()) {
  const parados = (await semRespostaDoBot(supabase, agora)).slice(0, POR_RODADA);
  const resultado = [];
  for (const p of parados) {
    const r = await responderForaDeHorario(supabase, p.id);
    if (!r.enviou) console.error("[bot/resgate]", p.id, r.motivo ?? "sem motivo");
    resultado.push({ lead: p.nome, desde: p.desde, ...r });
  }
  return resultado;
}
