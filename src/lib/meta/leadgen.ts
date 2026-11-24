// Entrada de um lead de formulario instantaneo da Meta no CRM. SERVER-ONLY.
//
// Dois caminhos chamam isto:
//   - o webhook /api/webhook/meta, quando a Meta avisa do lead na hora;
//   - a rotina /api/cron/meta-leads, que confere os formularios e traz o
//     lead cujo aviso nao chegou ou falhou.
//
// A rotina existe porque em 24/11/2026 a conferencia com a Meta achou 11
// formularios de 11 a 24/11 sem card no CRM. O aviso da Meta tinha chegado
// (284 de 284 conferidos, entre 4 e 19 segundos): os cards foram excluidos
// na tela de leads, 9 deles por serem o card parado de quem conversava por
// outro numero (ver lib/leads/gemeos.ts). A rotina fica como rede para o
// dia em que o aviso falhar de verdade.

import type { SupabaseClient } from "@supabase/supabase-js";
import { brCanonical, last8 } from "@/lib/phone";
import { emailDoFormulario } from "@/lib/bot/formulario";
import { cardDaConversaPeloEmail } from "@/lib/leads/gemeos";

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

// Token da pagina de reserva.
//
// META_PAGE_ACCESS_TOKEN nasceu do login de uma pessoa: se ela trocar a
// senha, sair do Business ou a Meta vencer o acesso (em 24/11/2026 a Meta ja
// marcava o "acesso aos dados" dele como vencido desde 15/11, embora ainda
// respondesse), o aviso de lead E a rotina de conferencia parariam juntos,
// porque os dois usam o mesmo token. A reserva pede um token da pagina ao
// usuario de sistema (META_ADS_ACCESS_TOKEN), que nao vence e nao depende
// de ninguem. So entra quando o token principal falha.
let reserva: { token: string; ate: number } | null = null;
export async function tokenDaPaginaReserva(): Promise<string | null> {
  const sistema = process.env.META_ADS_ACCESS_TOKEN;
  const pagina = process.env.META_PAGE_ID;
  if (!sistema || !pagina) return null;
  if (reserva && reserva.ate > Date.now()) return reserva.token;
  try {
    const res = await fetch(
      `${GRAPH}/${pagina}?fields=access_token&access_token=${encodeURIComponent(sistema)}`,
      { cache: "no-store" }
    );
    const j = (await res.json()) as { access_token?: string; error?: { message?: string } };
    if (!res.ok || !j.access_token) {
      console.error("[meta/leadgen] token de reserva da pagina nao veio:", j?.error?.message ?? res.status);
      return null;
    }
    reserva = { token: j.access_token, ate: Date.now() + 30 * 60_000 };
    return reserva.token;
  } catch (e) {
    console.error("[meta/leadgen] token de reserva da pagina falhou:", e);
    return null;
  }
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

  // Nenhum card com este numero: a pessoa pode ja estar conversando de
  // OUTRO numero (a mensagem pronta do formulario cita o e-mail). O
  // formulario entra no card da conversa em vez de criar um segundo.
  if (!existente) {
    const conversa = await cardDaConversaPeloEmail(
      supabase,
      emailDoFormulario(extras, email),
      new Date(lead.created_time ?? Date.now())
    );
    if (conversa) {
      const { data: atual } = await supabase
        .from("leads")
        .select("email, necessidade, meta_ad_id, data_conversao, anotacoes")
        .eq("id", conversa)
        .single();
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
          page_id: (aviso.page_id as string) ?? null,
          meta_ad_id: (atual?.meta_ad_id as string | null) ?? adId,
          email: (atual?.email as string | null) ?? email,
          necessidade: (atual?.necessidade as string | null) ?? (extras || null),
          data_conversao: (atual?.data_conversao as string | null) ?? lead.created_time ?? null,
          anotacoes: [
            atual?.anotacoes as string | null,
            `📋 Preencheu o formulário com outro número: ${whatsapp ?? "não informado"}.`,
          ]
            .filter(Boolean)
            .join("\n"),
        })
        .eq("id", conversa)
        .is("meta_lead_id", null);
      if (upErr) {
        console.error("[meta/leadgen] update (conversa) error:", upErr);
        return { ok: false, erro: `db:${upErr.code ?? ""}:${upErr.message}` };
      }
      return { ok: true, acao: "atualizado", id: conversa };
    }
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
