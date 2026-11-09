// Card gemeo do formulario. SERVER-ONLY.
//
// A pessoa preenche o formulario com um numero (card com meta_lead_id) e
// conversa por outro card: o do WhatsApp, as vezes de outro numero. O
// retorno para a Meta precisa do lead_id do formulario; sem ele o evento
// fica "sem_lead_id", e pelo Click-to-WhatsApp o desqualificado e recusado
// (Gustavo Silva e Cristiano brisa, em 09/11/2026).

import type { SupabaseClient } from "@supabase/supabase-js";
import { brCanonical, last8 } from "@/lib/phone";
import { emailDoFormulario } from "@/lib/bot/formulario";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JANELA_DIAS = 30;

type Card = {
  id: string;
  whatsapp: string | null;
  email: string | null;
  necessidade: string | null;
  created_at: string;
};

/** lead_id do formulario de outro card da mesma pessoa, ou null. */
export async function leadIdDoGemeo(admin: SupabaseClient, leadId: string): Promise<string | null> {
  const { data } = await admin
    .from("leads")
    .select("id, whatsapp, email, necessidade, created_at")
    .eq("id", leadId)
    .single();
  const lead = data as Card | null;
  if (!lead) return null;

  const base = new Date(lead.created_at).getTime();
  const de = new Date(base - JANELA_DIAS * 86_400_000).toISOString();
  const ate = new Date(base + JANELA_DIAS * 86_400_000).toISOString();
  const candidatos: { id: string; meta_lead_id: string; ja_cliente: boolean; created_at: string }[] = [];
  const campos = "id, whatsapp, meta_lead_id, ja_cliente, created_at";

  if (lead.whatsapp) {
    const { data: mesmoNumero } = await admin
      .from("leads")
      .select(campos)
      .like("whatsapp_digits", `%${last8(lead.whatsapp)}`)
      .not("meta_lead_id", "is", null)
      .neq("id", lead.id)
      .gte("created_at", de)
      .lte("created_at", ate)
      .limit(10);
    for (const o of mesmoNumero ?? []) {
      if (brCanonical(o.whatsapp as string | null) === brCanonical(lead.whatsapp)) candidatos.push(o as (typeof candidatos)[number]);
    }
  }

  // E-mail do proprio card ou citado na conversa: o formulario manda a
  // mensagem pronta com "Work email: ...".
  const emails = new Set<string>();
  const proprio = emailDoFormulario(lead.necessidade, lead.email);
  if (proprio) emails.add(proprio.toLowerCase());
  const { data: falas } = await admin
    .from("lead_messages")
    .select("body")
    .eq("lead_id", lead.id)
    .eq("direction", "inbound")
    .limit(30);
  for (const f of falas ?? []) {
    for (const e of ((f.body as string | null) ?? "").match(EMAIL) ?? []) emails.add(e.toLowerCase());
  }
  for (const email of [...emails].slice(0, 3)) {
    for (const coluna of ["email", "necessidade"] as const) {
      const { data: mesmoEmail } = await admin
        .from("leads")
        .select(campos)
        .ilike(coluna, coluna === "email" ? email : `%${email}%`)
        .not("meta_lead_id", "is", null)
        .neq("id", lead.id)
        .gte("created_at", de)
        .lte("created_at", ate)
        .limit(5);
      candidatos.push(...((mesmoEmail ?? []) as typeof candidatos));
    }
  }

  // Gemeo que e cliente: a conversa nao e aquisicao, nada vai para a Meta.
  if (candidatos.some((c) => c.ja_cliente)) return null;
  const maisProximo = candidatos.sort(
    (a, b) => Math.abs(new Date(a.created_at).getTime() - base) - Math.abs(new Date(b.created_at).getTime() - base)
  )[0];
  return maisProximo?.meta_lead_id ?? null;
}
