import type { SupabaseClient } from "@supabase/supabase-js";
import { FOLLOWUP_CADENCE, renderTemplate } from "./cadence";

// Cria os follow-ups pendentes de um lead, a partir de um horario base.
// Idempotente: nao duplica um template ja existente para o lead.
export async function scheduleFollowUpsForLead(
  supabase: SupabaseClient,
  lead: { id: string; nome: string; created_at?: string }
) {
  const base = lead.created_at ? new Date(lead.created_at) : new Date();

  // Templates ja existentes para nao duplicar.
  const { data: existing } = await supabase
    .from("follow_ups")
    .select("template_key")
    .eq("lead_id", lead.id);

  const done = new Set((existing ?? []).map((r) => r.template_key as string));

  const rows = FOLLOWUP_CADENCE.filter((s) => !done.has(s.key)).map((step) => ({
    lead_id: lead.id,
    template_key: step.key,
    titulo: step.titulo,
    body: renderTemplate(step.body, lead.nome),
    scheduled_at: new Date(
      base.getTime() + step.offsetHours * 3600_000
    ).toISOString(),
    status: "pendente" as const,
    canal: "whatsapp",
  }));

  if (rows.length === 0) return;
  await supabase.from("follow_ups").insert(rows);
}
