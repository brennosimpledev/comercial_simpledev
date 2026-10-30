"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarFechamentoPendente, reportConversion } from "@/lib/conversions/report";
import { parseValor } from "@/lib/valor";

// Valor do contrato e retorno do fechamento para Meta e Google, a partir
// do funil do closer.

export type EnvioConversao = {
  tipo: string;
  canal: string;
  status: string;
  valor: number | null;
  enviado_em: string | null;
  erro: string | null;
};

export async function statusConversoes(
  leadId: string
): Promise<{ envios?: EnvioConversao[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };
  const { data } = await createAdminClient()
    .from("ads_conversions")
    .select("tipo, canal, status, valor, uploaded_at, erro")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return {
    envios: (data ?? []).map((r) => ({
      tipo: r.tipo as string,
      canal: r.canal as string,
      status: r.status as string,
      valor: r.valor === null ? null : Number(r.valor),
      enviado_em: (r.uploaded_at as string | null) ?? null,
      erro: (r.erro as string | null) ?? null,
    })),
  };
}

/**
 * Grava o valor do contrato. Se o lead ja esta fechado, manda o fechamento
 * que esperava o valor; se o fechamento nunca foi registrado (fechou antes
 * da integracao, ou o registro falhou), registra e manda agora.
 */
export async function salvarValorFechado(
  leadId: string,
  texto: string
): Promise<{ ok?: boolean; valor?: number; error?: string }> {
  const valor = parseValor(texto);
  if (!valor) return { error: "Digite um valor, por exemplo 50.000 ou 50 mil." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: lead, error } = await supabase
    .from("leads")
    .update({ valor_fechado: valor })
    .eq("id", leadId)
    .select("estagio, status")
    .single();
  if (error || !lead) return { error: "Não foi possível salvar o valor." };

  if (lead.estagio === "fechado" || lead.status === "ganho") {
    after(async () => {
      await enviarFechamentoPendente(leadId);
      const { count } = await createAdminClient()
        .from("ads_conversions")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadId)
        .eq("tipo", "fechado");
      if (!count) await reportConversion(leadId, "fechado");
    });
  }

  revalidatePath("/funil");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, valor };
}
