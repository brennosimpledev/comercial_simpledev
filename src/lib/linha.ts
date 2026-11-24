// Por qual WhatsApp sai a conversa de reuniao de cada lead. SERVER-ONLY.
//
// Antes da primeira reuniao o lead conversa com o SDR. Depois que uma
// reuniao dele e marcada como Realizada, ele ja conheceu o closer: lembrete,
// confirmacao e remarcacao passam a sair do WhatsApp do closer, e o bot de
// reuniao escuta a resposta la.
//
// Se a linha do closer estiver fora do ar, tudo volta para o SDR: perder o
// lembrete e pior do que manda-lo pelo numero de antes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { estadoDaInstancia, NOME_DA_INSTANCIA, type Papel } from "@/lib/evolution/instancias";

export type Linha = Papel;

/** Linha de cada lead: closer para quem ja teve reuniao realizada. */
export async function linhasDosLeads(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, Linha>> {
  const mapa = new Map<string, Linha>(ids.map((id) => [id, "sdr"]));
  if (ids.length === 0) return mapa;
  const { data } = await supabase
    .from("meetings")
    .select("lead_id")
    .in("lead_id", ids)
    .eq("status", "realizada");
  for (const r of data ?? []) mapa.set(r.lead_id as string, "closer");
  return mapa;
}

export async function linhaDoLead(supabase: SupabaseClient, leadId: string): Promise<Linha> {
  return (await linhasDosLeads(supabase, [leadId])).get(leadId) ?? "sdr";
}

export async function closerNoAr(): Promise<boolean> {
  return (await estadoDaInstancia(NOME_DA_INSTANCIA.closer)) === "open";
}

export type Msg = {
  lead_id: string;
  direction: string;
  created_at: string;
  body: string | null;
  media_type: string | null;
  wa_message_id: string | null;
  raw: Record<string, unknown> | null;
};

const TABELA: Record<Linha, string> = { sdr: "lead_messages", closer: "closer_messages" };
// closer_messages guarda a hora da mensagem no WhatsApp em sent_at.
const HORA: Record<Linha, string> = { sdr: "created_at", closer: "sent_at" };
const COLUNAS: Record<Linha, string> = {
  sdr: "lead_id, direction, created_at, body, media_type, wa_message_id, raw",
  closer: "lead_id, direction, created_at:sent_at, body, media_type, wa_message_id, raw",
};
// Sem a migration 0026 closer_messages nao tem raw: le sem a marca.
const COLUNAS_SEM_RAW = "lead_id, direction, created_at:sent_at, body, media_type, wa_message_id";

/** Conversa de uma linha. `ordem` "desc" traz a mais recente primeiro. */
export async function lerMensagens(
  supabase: SupabaseClient,
  linha: Linha,
  filtro: { leadIds: string[]; desde?: string; limite?: number; ordem?: "asc" | "desc" }
): Promise<Msg[]> {
  if (filtro.leadIds.length === 0) return [];
  const consulta = (colunas: string) => {
    let q = supabase.from(TABELA[linha]).select(colunas).in("lead_id", filtro.leadIds);
    if (filtro.desde) q = q.gte(HORA[linha], filtro.desde);
    q = q.order(HORA[linha], { ascending: filtro.ordem === "asc" });
    if (filtro.limite) q = q.limit(filtro.limite);
    return q;
  };
  let { data, error } = await consulta(COLUNAS[linha]);
  if (error && linha === "closer") ({ data, error } = await consulta(COLUNAS_SEM_RAW));
  if (error) {
    console.error(`[linha] leitura ${linha}:`, error.message);
    return [];
  }
  return ((data ?? []) as unknown as Msg[]).map((m) => ({ ...m, raw: m.raw ?? null }));
}

/** Grava a mensagem que o sistema mandou, na tabela da linha. */
export async function registrarSaida(
  supabase: SupabaseClient,
  linha: Linha,
  m: { lead_id: string; body: string; wa_message_id: string | null; raw: Record<string, unknown> }
) {
  if (linha === "sdr") {
    const { error } = await supabase
      .from("lead_messages")
      .insert({ ...m, direction: "outbound", status: "sent" });
    if (error) console.error("[linha] registro sdr:", error.message);
    return;
  }

  // A Evolution devolve a mensagem enviada tambem pelo webhook do closer, que
  // grava sem a marca de automatica. Quem chegar primeiro grava; o upsert pelo
  // wa_message_id garante que a marca fica, senao o bot e o cron leem o
  // proprio lembrete como se o closer tivesse escrito.
  const gravar = (linhaCloser: Record<string, unknown>) =>
    m.wa_message_id
      ? supabase.from("closer_messages").upsert(linhaCloser, { onConflict: "wa_message_id" })
      : supabase.from("closer_messages").insert(linhaCloser);
  const base = { lead_id: m.lead_id, direction: "outbound", body: m.body, wa_message_id: m.wa_message_id };
  let { error } = await gravar({ ...base, raw: m.raw });
  if (error) ({ error } = await gravar(base));
  if (error) console.error("[linha] registro closer:", error.message);
}

export const automatica = (m: Pick<Msg, "direction" | "raw">) =>
  m.direction === "outbound" &&
  Boolean(m.raw && ((m.raw as { bot?: boolean }).bot || (m.raw as { lembrete?: string }).lembrete));
