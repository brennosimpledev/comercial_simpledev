"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseValor } from "@/lib/valor";
import type { LeadUpsell } from "@/types/database";

// Vendas novas para quem ja e cliente. Diferente de valor_fechado, upsell
// nao vira conversao de anuncio: quando a venda acontece, a janela de
// atribuicao da Meta e do Google ja fechou. Ver migration 0025.

export async function listarUpsells(
  leadId: string
): Promise<{ upsells?: LeadUpsell[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data, error } = await supabase
    .from("lead_upsells")
    .select("*")
    .eq("lead_id", leadId)
    .order("data", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return { error: "Não foi possível carregar os upsells." };

  return { upsells: (data ?? []) as LeadUpsell[] };
}

export async function adicionarUpsell(
  leadId: string,
  texto: string,
  descricao: string
): Promise<{ upsell?: LeadUpsell; error?: string }> {
  // Mesmo parser do valor do contrato: aceita "12.000", "12 mil", "12k".
  const valor = parseValor(texto);
  if (!valor) return { error: "Digite um valor, por exemplo 12.000 ou 12 mil." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data, error } = await supabase
    .from("lead_upsells")
    .insert({
      lead_id: leadId,
      valor,
      descricao: descricao.trim() || null,
      created_by: user.id,
    })
    .select("*")
    .single();
  if (error || !data) return { error: "Não foi possível salvar o upsell." };

  revalidatePath("/funil");
  revalidatePath("/clientes");
  revalidatePath(`/leads/${leadId}`);
  return { upsell: data as LeadUpsell };
}

export async function removerUpsell(
  id: string
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase.from("lead_upsells").delete().eq("id", id);
  if (error) return { error: "Não foi possível remover o upsell." };

  revalidatePath("/funil");
  revalidatePath("/clientes");
  return { ok: true };
}
