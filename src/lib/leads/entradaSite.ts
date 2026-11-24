// Entrada de um lead vindo do site (LP e formulario). SERVER-ONLY.
//
// Procura o lead pelo telefone antes de inserir (nunca duplica), deriva a
// origem pelas UTMs/identificadores de clique, grava oppref/obref quando
// vierem e avisa a OpenAI da entrada (todo lead do site, nao so o do
// ChatGPT: ver lib/openai/conversions.ts).

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapWebhookToLead, rastreioOpenAI, type LpWebhookPayload } from "@/lib/mappers/webhook-lead";
import { reportarLeadOpenAI } from "@/lib/conversions/report";
import { brCanonical, last8 } from "@/lib/phone";

export async function entrarLeadDoSite(
  payload: LpWebhookPayload,
  // IP e navegador de quem preencheu: o webhook recebe a requisicao direto
  // do navegador da pessoa. Vao so para a OpenAI, para casar a conversao.
  contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ ok: true; id: string; acao: "criado" | "atualizado" } | { error: string }> {
  const lead = mapWebhookToLead(payload);
  const openai = rastreioOpenAI(payload);

  // Grava oppref/obref e avisa a OpenAI da entrada do lead (o pixel da LP
  // manda o mesmo evento com o mesmo id; a OpenAI conta uma vez). O obref
  // existe para qualquer visitante, nao so para quem clicou no ChatGPT.
  async function registrarChatgpt(id: string) {
    const campos: Record<string, string> = {};
    if (openai.openai_oppref) campos.openai_oppref = openai.openai_oppref;
    if (openai.openai_obref) campos.openai_obref = openai.openai_obref;
    if (Object.keys(campos).length) {
      const { error: e } = await supabase.from("leads").update(campos).eq("id", id);
      if (e) console.error("[webhook/lead] openai:", e.message);
    }
    after(() => reportarLeadOpenAI(id, openai.eventId, contexto));
  }

  const supabase = createAdminClient();

  // Procura lead existente pelo telefone antes de inserir.
  //
  // Sem isto, uma automacao reprocessando o historico cria uma copia de
  // cada lead que ja estava na base - foi o que aconteceu em 01/09/2026,
  // quando uma re-execucao gerou 40 duplicatas em um minuto. Mesmo criterio
  // dos webhooks da Meta e do WhatsApp: canonico BR, DDD + 8 digitos.
  const digitos = String(lead.whatsapp ?? "").replace(/[^0-9]/g, "");
  let existente: string | undefined;

  if (digitos.length >= 10) {
    const canon = brCanonical(digitos);
    const { data: candidatos } = await supabase
      .from("leads")
      .select("id, whatsapp")
      .like("whatsapp_digits", `%${last8(digitos)}`)
      .limit(10);
    existente = (candidatos ?? []).find(
      (c) => brCanonical(c.whatsapp) === canon
    )?.id;
  }

  if (existente) {
    // Completa so o rastreio que estiver faltando. Nunca toca em nome,
    // estagio, anotacoes ou valor: o SDR pode ja ter trabalhado o lead.
    const rastreio: Record<string, unknown> = {};
    for (const campo of [
      "gclid",
      "gbraid",
      "wbraid",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ] as const) {
      const v = (lead as Record<string, unknown>)[campo];
      if (v) rastreio[campo] = v;
    }

    if (Object.keys(rastreio).length) {
      await supabase.from("leads").update(rastreio).eq("id", existente);
    }
    await registrarChatgpt(existente);

    return { ok: true as const, id: existente, acao: "atualizado" as const };
  }

  let { data, error } = await supabase
    .from("leads")
    .insert(lead)
    .select("id, nome, created_at")
    .single();

  // Sem a migration 0024 a origem "chatgpt_ads" nao existe no banco: entra
  // como "outro" (as UTMs mostram de onde veio) em vez de perder o lead.
  if (error && lead.origem === "chatgpt_ads") {
    ({ data, error } = await supabase
      .from("leads")
      .insert({ ...lead, origem: "outro" as const })
      .select("id, nome, created_at")
      .single());
  }

  if (error || !data) {
    console.error("[webhook/lead] insert error:", error);
    return { error: "could not save lead" as const };
  }

  await registrarChatgpt(data.id as string);
  return { ok: true as const, id: data.id as string, acao: "criado" as const };
}

