"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeadContato } from "@/types/database";

// Diario de follow-up do closer: o que foi conversado e quando voltar.
// Nada aqui dispara mensagem - a regua automatica e outra coisa.

async function sessao() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function listarContatos(leadId: string) {
  const { supabase, user } = await sessao();
  if (!user) return { error: "Não autenticado.", contatos: [] as LeadContato[] };

  const { data, error } = await supabase
    .from("lead_contatos")
    .select("*")
    .eq("lead_id", leadId)
    .order("feito_em", { ascending: false });

  if (error) {
    console.error("[listarContatos]", error);
    return { error: "Falha ao carregar follow-ups.", contatos: [] as LeadContato[] };
  }
  return { contatos: (data ?? []) as LeadContato[] };
}

export async function registrarContato(
  leadId: string,
  dados: { resumo: string; canal?: string; proximoEm?: string | null }
) {
  const { supabase, user } = await sessao();
  if (!user) return { error: "Não autenticado." };

  const resumo = dados.resumo.trim();
  if (!resumo && !dados.proximoEm) {
    return { error: "Escreva o que aconteceu ou marque uma data de retorno." };
  }

  // O retorno anterior deixa de valer: quem manda e o ultimo registro.
  await supabase
    .from("lead_contatos")
    .update({ concluido: true })
    .eq("lead_id", leadId)
    .eq("concluido", false);

  const { error } = await supabase.from("lead_contatos").insert({
    lead_id: leadId,
    canal: dados.canal ?? "whatsapp",
    resumo: resumo || null,
    proximo_em: dados.proximoEm || null,
    concluido: !dados.proximoEm,
    created_by: user.id,
  });
  if (error) {
    console.error("[registrarContato]", error);
    return { error: "Falha ao registrar follow-up." };
  }

  await supabase
    .from("leads")
    .update({ proximo_contato: dados.proximoEm || null })
    .eq("id", leadId);

  revalidatePath("/funil");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// Empurra o retorno sem precisar escrever nada de novo.
export async function adiarRetorno(leadId: string, dias: number) {
  const { supabase, user } = await sessao();
  if (!user) return { error: "Não autenticado." };

  const { data: lead } = await supabase
    .from("leads")
    .select("proximo_contato")
    .eq("id", leadId)
    .single();

  const base = lead?.proximo_contato ? new Date(lead.proximo_contato) : new Date();
  const hoje = new Date();
  // Retorno atrasado conta a partir de hoje, nao da data vencida.
  const partida = base > hoje ? base : hoje;
  partida.setDate(partida.getDate() + dias);
  const novo = partida.toISOString().slice(0, 10);

  await supabase
    .from("lead_contatos")
    .update({ proximo_em: novo })
    .eq("lead_id", leadId)
    .eq("concluido", false);

  await supabase.from("leads").update({ proximo_contato: novo }).eq("id", leadId);

  revalidatePath("/funil");
  return { ok: true, proximo: novo };
}

export async function limparRetorno(leadId: string) {
  const { supabase, user } = await sessao();
  if (!user) return { error: "Não autenticado." };

  await supabase
    .from("lead_contatos")
    .update({ concluido: true })
    .eq("lead_id", leadId)
    .eq("concluido", false);
  await supabase.from("leads").update({ proximo_contato: null }).eq("id", leadId);

  revalidatePath("/funil");
  return { ok: true };
}
