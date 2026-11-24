// Entrada de um lead de formulario instantaneo da Meta no CRM. SERVER-ONLY.
//
// Dois caminhos chamam isto:
//   - o webhook /api/webhook/meta, quando a Meta avisa do lead na hora;
//   - a rotina /api/cron/meta-leads, que confere os formularios e traz o
//     lead cujo aviso nao chegou ou falhou.
//
// A rotina existe porque em 24/11/2026 a conferencia com a Meta achou 11
// leads de 11 a 24/11 que nunca entraram no CRM (ninguem falou com eles). A
// causa nao ficou provada: ou o aviso nao foi entregue, ou a busca/gravacao
// falhou aqui, e nos dois casos nada tentava de novo.

import type { SupabaseClient } from "@supabase/supabase-js";
import { brCanonical, last8 } from "@/lib/phone";

export const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

export interface LeadFieldDatum {
  name: string;
  values: string[];
}

export type LeadDaMeta = {
  field_data?: LeadFieldDatum[];
  created_time?: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  ad_id?: string;
  form_id?: string;
  platform?: string;
};

export function mapFields(fieldData: LeadFieldDatum[] = []) {
  const m: Record<string, string> = {};
  for (const f of fieldData) m[f.name] = (f.values ?? []).join(", ");
  return m;
}

/** Dados completos do lead na Graph API. Devolve `erro` em vez de lancar. */
export async function buscarLeadNaMeta(
  leadgenId: string,
  token: string
): Promise<{ lead: LeadDaMeta } | { erro: string }> {
  try {
    const res = await fetch(
      `${GRAPH}/${leadgenId}?fields=field_data,created_time,campaign_name,adset_name,ad_name,ad_id,form_id,platform&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const lead = await res.json();
    if (!res.ok) {
      console.error("[meta/leadgen] graph error:", lead);
      const gErr = (lead as { error?: { message?: string; code?: number } })?.error;
      return { erro: `graph_${res.status}:${gErr?.code ?? "?"}:${gErr?.message ?? "erro"}` };
    }
    return { lead: lead as LeadDaMeta };
  } catch (e) {
    console.error("[meta/leadgen] graph fetch failed:", e);
    return { erro: "graph_fetch_falhou" };
  }
}

/**
 * Grava o lead no CRM: completa um lead que ja existe com o mesmo telefone
 * ou cria um novo. `aviso` e o que veio no webhook (form_id, ad_id, page_id);
 * na rotina de conferencia vem montado a partir do proprio lead.
 * `recuperado` marca o lead que entrou pela rotina: a data de criacao passa
 * a ser a do formulario, para o bot de primeiro contato nao tratar como
 * recem-chegado quem preencheu ha dias (a regra dele e 16 horas).
 */
export async function gravarLeadDaMeta(
  supabase: SupabaseClient,
  leadgenId: string,
  lead: LeadDaMeta,
  aviso: Record<string, unknown>,
  opts: { recuperado?: boolean } = {}
): Promise<{ ok: true; acao: "criado" | "atualizado"; id: string } | { ok: false; erro: string }> {
  const f = mapFields(lead.field_data);
  const nome =
    f.full_name ||
    f.name ||
    [f.first_name, f.last_name].filter(Boolean).join(" ") ||
    "Lead Meta";
  const email = f.email || f.work_email || null;
  const whatsapp = f.phone_number || f.phone || null;
  const formId = ((aviso.form_id as string) ?? lead.form_id ?? null) as string | null;
  const adId = ((aviso.ad_id as string) ?? lead.ad_id ?? null) as string | null;

  // Campos personalizados (perguntas do formulario) -> necessidade.
  const known = new Set(["full_name", "name", "first_name", "last_name", "email", "phone_number", "phone"]);
  const extras = Object.entries(f)
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");

  // O lead pode ja existir: a automacao que repassa o formulario pelo
  // WhatsApp costuma chegar antes deste webhook, e nesse caminho nao ha
  // leadgen_id. Sem procurar antes, este insert criava um SEGUNDO lead
  // com o identificador enquanto o SDR trabalhava e qualificava o
  // primeiro, que ficava sem. Era a causa de 15 das 22 conversoes da
  // Meta nunca terem sido devolvidas.
  const digitos = (whatsapp ?? "").replace(/[^0-9]/g, "");
  let existente: string | undefined;

  if (digitos.length >= 8) {
    const canon = brCanonical(digitos);
    const { data: candidatos } = await supabase
      .from("leads")
      .select("id, whatsapp")
      .like("whatsapp_digits", `%${last8(digitos)}`)
      .limit(10);
    existente = (candidatos ?? []).find((c) => brCanonical(c.whatsapp) === canon)?.id;
  }

  if (existente) {
    // Completa o que falta em vez de duplicar. Nao mexe em nome, estagio
    // nem anotacoes: o SDR pode ja ter trabalhado este lead.
    const { error: upErr } = await supabase
      .from("leads")
      .update({
        meta_lead_id: leadgenId,
        origem: "meta_ads",
        utm_source: "meta",
        utm_medium: "paid",
        utm_campaign: lead.campaign_name ?? null,
        utm_content: lead.ad_name ?? null,
        form_id: formId,
        meta_ad_id: adId,
      })
      .eq("id", existente)
      // Nao sobrescreve um identificador que ja esteja la.
      .is("meta_lead_id", null);

    if (upErr) {
      console.error("[meta/leadgen] update error:", upErr);
      return { ok: false, erro: `db:${upErr.code ?? ""}:${upErr.message}` };
    }
    return { ok: true, acao: "atualizado", id: existente };
  }

  const { data: inserted, error } = await supabase
    .from("leads")
    .insert({
      nome,
      email,
      whatsapp,
      origem: "meta_ads",
      // Coluna propria: e o identificador que devolve a conversao a Meta.
      meta_lead_id: leadgenId,
      necessidade: extras || null,
      estagio: "novo",
      status: "ativo",
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: lead.campaign_name ?? null,
      utm_content: lead.ad_name ?? null,
      referral_source: lead.platform ?? null,
      data_conversao: lead.created_time ?? null,
      form_id: formId,
      // Id do anuncio: sem ele nao da para medir qualidade por criativo
      // (o nome muda quando o anuncio e duplicado ou renomeado).
      meta_ad_id: adId,
      page_id: (aviso.page_id as string) ?? null,
      raw_payload: { leadgen: aviso, lead } as Record<string, unknown>,
      ...(opts.recuperado && lead.created_time
        ? {
            created_at: new Date(lead.created_time).toISOString(),
            anotacoes:
              "⚠️ Lead recuperado pela conferência com a Meta: o aviso do formulário não chegou ao CRM na hora. " +
              `Preencheu em ${new Date(lead.created_time).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
          }
        : {}),
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[meta/leadgen] insert error:", error);
    return { ok: false, erro: `db:${error?.code ?? ""}:${error?.message ?? "sem retorno"}` };
  }
  return { ok: true, acao: "criado", id: inserted.id as string };
}
