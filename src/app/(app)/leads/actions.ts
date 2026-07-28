"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { manualLeadSchema } from "@/lib/validators/lead";
import type { LeadStage } from "@/types/database";

const VALID_STAGES: LeadStage[] = [
  "novo",
  "sdr",
  "reuniao_marcada",
  "proposta",
  "fechado",
  "perdido",
];

// Muda o estagio de um lead (usado pelo drag-and-drop do Kanban).
export async function updateLeadStage(id: string, estagio: LeadStage) {
  if (!VALID_STAGES.includes(estagio)) {
    return { error: "Estágio inválido." };
  }

  const supabase = await createClient();

  // Regra simples: fechado -> status ganho; perdido -> status perdido.
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

  if (error) {
    return { error: "Não foi possível mover o lead." };
  }

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

  const { error } = await supabase.from("leads").insert({
    ...parsed.data,
    created_by: user?.id ?? null,
  });

  if (error) {
    return { error: "Não foi possível salvar o lead." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/leads");
  redirect("/leads");
}

// Atualiza anotacoes e responsavel a partir da tela de detalhe.
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
