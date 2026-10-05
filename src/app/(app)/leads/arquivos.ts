"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ArquivoTipo, LeadArquivo } from "@/types/database";
import { avancarEstagio } from "./actions";

// Bucket privado: escopo e proposta sao documentos do cliente, entao a
// listagem devolve link assinado de curta duracao em vez de URL publica.
const BUCKET = "leads";
const VALIDADE_LINK = 60 * 60; // 1h

export type ArquivoComLink = LeadArquivo & { url: string | null };

async function exigeSessao() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function listarArquivos(leadId: string) {
  const { supabase, user } = await exigeSessao();
  if (!user) return { error: "Não autenticado.", arquivos: [] as ArquivoComLink[] };

  const { data, error } = await supabase
    .from("lead_arquivos")
    .select("*")
    .eq("lead_id", leadId)
    .order("tipo", { ascending: true })
    .order("versao", { ascending: false });

  if (error) {
    console.error("[listarArquivos]", error);
    return { error: "Falha ao carregar arquivos.", arquivos: [] as ArquivoComLink[] };
  }

  const admin = createAdminClient();
  const arquivos: ArquivoComLink[] = await Promise.all(
    (data ?? []).map(async (a) => {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(a.path, VALIDADE_LINK);
      return { ...(a as LeadArquivo), url: signed?.signedUrl ?? null };
    })
  );
  return { arquivos };
}

export async function uploadArquivo(leadId: string, formData: FormData) {
  const { supabase, user } = await exigeSessao();
  if (!user) return { error: "Não autenticado." };

  const file = formData.get("file") as File;
  if (!file || typeof file === "string") return { error: "Nenhum arquivo selecionado." };

  const tipo = (formData.get("tipo") as ArquivoTipo) ?? "escopo";
  const valorBruto = (formData.get("valor") as string) ?? "";
  const valor = valorBruto ? Number(valorBruto.replace(/\./g, "").replace(",", ".")) : null;
  const observacao = ((formData.get("observacao") as string) ?? "").trim() || null;

  const admin = createAdminClient();
  await admin.storage.createBucket(BUCKET, { public: false });

  // Proxima versao deste tipo neste lead.
  const { data: ultima } = await supabase
    .from("lead_arquivos")
    .select("versao")
    .eq("lead_id", leadId)
    .eq("tipo", tipo)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versao = (ultima?.versao ?? 0) + 1;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${leadId}/${tipo}/v${versao}_${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type || "application/octet-stream" });
  if (upErr) {
    console.error("[uploadArquivo]", upErr);
    return { error: `Falha ao enviar ${file.name}.` };
  }

  // O novo vira o atual: tira a marca do anterior antes de inserir, senao
  // o indice unico parcial recusa a linha.
  await supabase
    .from("lead_arquivos")
    .update({ atual: false })
    .eq("lead_id", leadId)
    .eq("tipo", tipo)
    .eq("atual", true);

  const { error: dbErr } = await supabase.from("lead_arquivos").insert({
    lead_id: leadId,
    tipo,
    nome: file.name,
    path,
    versao,
    atual: true,
    valor: Number.isFinite(valor as number) ? valor : null,
    observacao,
    created_by: user.id,
  });

  if (dbErr) {
    console.error("[uploadArquivo db]", dbErr);
    await admin.storage.from(BUCKET).remove([path]);
    return { error: "Arquivo enviado mas falha ao registrar." };
  }

  // O primeiro escopo enviado move o lead de coluna sozinho, e a data do
  // envio passa a contar os dias de espera por resposta.
  if (tipo === "escopo") {
    await avancarEstagio(leadId, "escopo_enviado", [
      "novo",
      "sdr",
      "reuniao_marcada",
      "reuniao_feita",
    ]);
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/funil");
  return { ok: true, versao };
}

export async function marcarAtual(arquivoId: string) {
  const { supabase, user } = await exigeSessao();
  if (!user) return { error: "Não autenticado." };

  const { data: arq } = await supabase
    .from("lead_arquivos")
    .select("lead_id, tipo")
    .eq("id", arquivoId)
    .single();
  if (!arq) return { error: "Arquivo não encontrado." };

  await supabase
    .from("lead_arquivos")
    .update({ atual: false })
    .eq("lead_id", arq.lead_id)
    .eq("tipo", arq.tipo)
    .eq("atual", true);

  const { error } = await supabase
    .from("lead_arquivos")
    .update({ atual: true })
    .eq("id", arquivoId);
  if (error) return { error: "Falha ao marcar como atual." };

  revalidatePath(`/leads/${arq.lead_id}`);
  return { ok: true };
}

export async function removerArquivo(arquivoId: string) {
  const { supabase, user } = await exigeSessao();
  if (!user) return { error: "Não autenticado." };

  const { data: arq } = await supabase
    .from("lead_arquivos")
    .select("lead_id, tipo, path, atual")
    .eq("id", arquivoId)
    .single();
  if (!arq) return { error: "Arquivo não encontrado." };

  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove([arq.path]);
  await supabase.from("lead_arquivos").delete().eq("id", arquivoId);

  // Se o removido era o atual, a versao mais alta que sobrou assume.
  if (arq.atual) {
    const { data: proximo } = await supabase
      .from("lead_arquivos")
      .select("id")
      .eq("lead_id", arq.lead_id)
      .eq("tipo", arq.tipo)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (proximo) {
      await supabase.from("lead_arquivos").update({ atual: true }).eq("id", proximo.id);
    }
  }

  revalidatePath(`/leads/${arq.lead_id}`);
  return { ok: true };
}
