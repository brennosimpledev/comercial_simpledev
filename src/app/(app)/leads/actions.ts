"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { manualLeadSchema } from "@/lib/validators/lead";
import { scheduleFollowUpsForLead } from "@/lib/followups/schedule";
import { sendWhatsAppText } from "@/lib/evolution/client";
import type { LeadStage, LeadOrigin } from "@/types/database";

const VALID_STAGES: LeadStage[] = [
  "novo",
  "sdr",
  "reuniao_marcada",
  "proposta",
  "fechado",
  "perdido",
];

// Muda o estagio de um lead (drag-and-drop do Kanban).
export async function updateLeadStage(id: string, estagio: LeadStage) {
  if (!VALID_STAGES.includes(estagio)) {
    return { error: "Estágio inválido." };
  }
  const supabase = await createClient();
  const status =
    estagio === "fechado"
      ? "ganho"
      : estagio === "perdido"
        ? "perdido"
        : "ativo";

  const { error } = await supabase
    .from("leads")
    .update({ estagio, status })
    .eq("id", id);

  if (error) return { error: "Não foi possível mover o lead." };

  revalidatePath("/dashboard");
  revalidatePath("/leads");
  return { ok: true };
}

// Cadastro manual de lead (indicacoes).
export async function createManualLead(_prev: unknown, formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const parsed = manualLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({ ...parsed.data, created_by: user?.id ?? null })
    .select("id, nome, created_at")
    .single();

  if (error || !lead) return { error: "Não foi possível salvar o lead." };

  try {
    await scheduleFollowUpsForLead(supabase, lead);
  } catch {
    /* nao bloqueia o cadastro */
  }

  revalidatePath("/dashboard");
  revalidatePath("/leads");
  redirect("/leads");
}

// Exclui um lead (e, em cascata, mensagens e follow-ups).
export async function deleteLead(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: `Não foi possível excluir: ${error.message}` };
  if (!data || data.length === 0) {
    return { error: "Nada foi excluído (sem permissão ou lead inexistente)." };
  }
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return { ok: true };
}

const VALID_ORIGINS: LeadOrigin[] = [
  "google_ads",
  "meta_ads",
  "indicacao",
  "organico",
  "whatsapp",
  "workana",
  "outro",
];

// Edita os campos principais do lead (painel de infos).
export async function updateLeadInfo(
  id: string,
  fields: {
    nome?: string;
    whatsapp?: string;
    email?: string;
    origem?: string;
    orcamento?: string;
    necessidade?: string;
    prazo?: string;
  }
) {
  const nome = (fields.nome ?? "").trim();
  if (!nome) return { error: "Nome é obrigatório." };

  const origem: LeadOrigin = VALID_ORIGINS.includes(fields.origem as LeadOrigin)
    ? (fields.origem as LeadOrigin)
    : "outro";

  const clean = (v?: string) => {
    const s = (v ?? "").trim();
    return s.length ? s : null;
  };

  const { error } = await (await createClient())
    .from("leads")
    .update({
      nome,
      whatsapp: clean(fields.whatsapp),
      email: clean(fields.email),
      origem,
      orcamento: clean(fields.orcamento),
      necessidade: clean(fields.necessidade),
      prazo: clean(fields.prazo),
    })
    .eq("id", id);

  if (error) return { error: "Não foi possível salvar as alterações." };

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { ok: true };
}

// Anotacoes / descricao.
export async function updateLeadNotes(id: string, anotacoes: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ anotacoes })
    .eq("id", id);
  if (error) return { error: "Não foi possível salvar as anotações." };
  revalidatePath(`/leads/${id}`);
  return { ok: true };
}

// Liga/desliga uma flag (qualificado, sem_resposta, desqualificado, bot_pausado).
type LeadFlag =
  | "qualificado"
  | "sem_resposta"
  | "desqualificado"
  | "bot_pausado";

export async function toggleLeadFlag(
  id: string,
  flag: LeadFlag,
  value: boolean
) {
  const supabase = await createClient();
  const patch: Record<string, unknown> = { [flag]: value };

  // Coerencia com o pipeline.
  if (flag === "qualificado" && value) patch.desqualificado = false;
  if (flag === "desqualificado" && value) {
    patch.qualificado = false;
    patch.estagio = "perdido";
    patch.status = "perdido";
  }

  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  if (error) return { error: "Não foi possível atualizar." };

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { ok: true };
}

// Envia uma mensagem de WhatsApp e registra na conversa.
export async function sendLeadMessage(leadId: string, text: string) {
  const body = text.trim();
  if (!body) return { error: "Mensagem vazia." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: lead } = await supabase
    .from("leads")
    .select("whatsapp")
    .eq("id", leadId)
    .single();

  if (!lead?.whatsapp) {
    return { error: "Lead sem número de WhatsApp." };
  }

  const result = await sendWhatsAppText(lead.whatsapp, body);

  // Registra a mensagem mesmo se a Evolution nao estiver configurada,
  // marcando o status apropriado.
  await supabase.from("lead_messages").insert({
    lead_id: leadId,
    direction: "outbound",
    body,
    wa_message_id: result.waMessageId ?? null,
    status: result.ok ? "sent" : "failed",
    sent_by: user?.id ?? null,
  });

  revalidatePath(`/leads/${leadId}`);
  if (!result.ok) return { error: result.error };
  return { ok: true };
}

// Envia agora um follow-up especifico da regua (envio manual).
export async function sendFollowUpNow(followUpId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: fu } = await supabase
    .from("follow_ups")
    .select("id, lead_id, body, status")
    .eq("id", followUpId)
    .single();

  if (!fu) return { error: "Follow-up não encontrado." };
  if (fu.status !== "pendente") return { error: "Follow-up já processado." };

  const { data: lead } = await supabase
    .from("leads")
    .select("whatsapp")
    .eq("id", fu.lead_id)
    .single();

  if (!lead?.whatsapp) return { error: "Lead sem número de WhatsApp." };

  const result = await sendWhatsAppText(lead.whatsapp, fu.body);

  await supabase.from("lead_messages").insert({
    lead_id: fu.lead_id,
    direction: "outbound",
    body: fu.body,
    wa_message_id: result.waMessageId ?? null,
    status: result.ok ? "sent" : "failed",
    sent_by: user?.id ?? null,
  });

  if (result.ok) {
    await supabase
      .from("follow_ups")
      .update({
        status: "enviado",
        sent_at: new Date().toISOString(),
        sent_by: user?.id ?? null,
      })
      .eq("id", followUpId);
  }

  revalidatePath(`/leads/${fu.lead_id}`);
  if (!result.ok) return { error: result.error };
  return { ok: true };
}

// Marca um follow-up como pulado/cancelado (sem enviar).
export async function skipFollowUp(followUpId: string) {
  const supabase = await createClient();
  const { data: fu } = await supabase
    .from("follow_ups")
    .select("lead_id")
    .eq("id", followUpId)
    .single();
  const { error } = await supabase
    .from("follow_ups")
    .update({ status: "pulado" })
    .eq("id", followUpId);
  if (error) return { error: "Não foi possível pular." };
  if (fu) revalidatePath(`/leads/${fu.lead_id}`);
  return { ok: true };
}
