// Formulario da Meta preenchido com um numero e conversa por outro. SERVER-ONLY.
//
// A pessoa preenche o formulario instantaneo (o card nasce com o
// meta_lead_id, em media 7 segundos depois) e em seguida toca em "falar no
// WhatsApp" de OUTRO numero. Ate 24/11/2026 isso criava um segundo card: o
// da conversa, sem o identificador. Eram 19% dos leads de formulario.
//
// O card do formulario ficava parado em "novo", parecia lixo e era excluido
// na tela de leads. Junto ia o meta_lead_id, e a campanha deixava de receber
// o retorno daquela pessoa. A conferencia de 24/11/2026 achou 11 formularios
// sem card. No caso que ainda estava no registro do banco (1 dia de
// historico), o aviso da Meta chegou, o card foi criado em 7 segundos e foi
// excluido pela tela de leads horas depois. Dos 11, 9 eram deste tipo e 2
// eram numeros sem WhatsApp.
//
// Aqui ficam as tres pecas que acabam com o segundo card:
//   - cardDoFormularioPeloTexto: a conversa nova entra no card do formulario;
//   - cardDaConversaPeloEmail: o formulario que chega depois entra no card
//     da conversa;
//   - passarFormulario: leva a identificacao do formulario de um card para o
//     outro, usada antes de excluir o card vazio.

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailDoFormulario } from "@/lib/bot/formulario";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DIA = 86_400_000;

export function emailsDoTexto(texto: string | null | undefined): string[] {
  return [...new Set(((texto ?? "").match(EMAIL) ?? []).map((e) => e.toLowerCase()))].slice(0, 3);
}

// % e * sao curingas do ilike no PostgREST; e-mail com eles fica de fora.
const seguro = (email: string) => !email.includes("%") && !email.includes("*");

/**
 * Card do formulario de quem acabou de escrever citando o e-mail do
 * formulario (a mensagem pronta traz "Work email: ..."). So vale card que
 * ainda nao tem conversa: se o numero do formulario ja conversou, sao duas
 * conversas de verdade e cada uma fica no seu card.
 */
export async function cardDoFormularioPeloTexto(
  supabase: SupabaseClient,
  texto: string | null | undefined,
  agora = new Date()
): Promise<{ id: string; whatsapp: string | null; anotacoes: string | null } | null> {
  const desde = new Date(agora.getTime() - 7 * DIA).toISOString();
  for (const email of emailsDoTexto(texto).filter(seguro)) {
    for (const coluna of ["email", "necessidade"] as const) {
      const { data } = await supabase
        .from("leads")
        .select("id, whatsapp, anotacoes, email, necessidade")
        .ilike(coluna, coluna === "email" ? email : `%${email}%`)
        .not("meta_lead_id", "is", null)
        .eq("ja_cliente", false)
        .gte("created_at", desde)
        .lte("created_at", agora.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      for (const c of data ?? []) {
        if (emailDoFormulario(c.necessidade as string | null, c.email as string | null) !== email) continue;
        const { count } = await supabase
          .from("lead_messages")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", c.id as string);
        if ((count ?? 0) === 0) {
          return { id: c.id as string, whatsapp: c.whatsapp as string | null, anotacoes: c.anotacoes as string | null };
        }
      }
    }
  }
  return null;
}

/**
 * Card de conversa (sem meta_lead_id) em que a pessoa citou este e-mail,
 * perto da data do formulario. `menos` tira o proprio card da busca.
 */
export async function cardDaConversaPeloEmail(
  supabase: SupabaseClient,
  email: string | null | undefined,
  por: Date,
  menos?: string
): Promise<string | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !seguro(e) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  const { data: falas } = await supabase
    .from("lead_messages")
    .select("lead_id, created_at")
    .eq("direction", "inbound")
    .ilike("body", `%${e}%`)
    .gte("created_at", new Date(por.getTime() - 2 * DIA).toISOString())
    .lte("created_at", new Date(por.getTime() + 30 * DIA).toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  const ids = [...new Set((falas ?? []).map((f) => f.lead_id as string))].filter((id) => id !== menos);
  if (ids.length === 0) return null;
  const { data: cards } = await supabase
    .from("leads")
    .select("id, meta_lead_id, ja_cliente")
    .in("id", ids);
  const livres = new Set(
    (cards ?? []).filter((c) => !c.meta_lead_id && !c.ja_cliente).map((c) => c.id as string)
  );
  return ids.find((id) => livres.has(id)) ?? null;
}

type CardDoForm = {
  id: string;
  whatsapp: string | null;
  email: string | null;
  necessidade: string | null;
  meta_lead_id: string | null;
  form_id: string | null;
  meta_ad_id: string | null;
  page_id: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  referral_source: string | null;
  data_conversao: string | null;
};

const CAMPOS_DO_FORM =
  "id, whatsapp, email, necessidade, meta_lead_id, form_id, meta_ad_id, page_id, utm_campaign, utm_content, referral_source, data_conversao";

/**
 * Leva a identificacao do formulario do card `deId` para o card `paraId`
 * (o da conversa). Nao apaga nada: quem chama decide o que fazer com o card
 * que ficou vazio. Devolve erro se o destino ja tem um formulario.
 */
export async function passarFormulario(
  supabase: SupabaseClient,
  deId: string,
  paraId: string
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { data: de } = await supabase.from("leads").select(CAMPOS_DO_FORM).eq("id", deId).single();
  const { data: para } = await supabase
    .from("leads")
    .select("id, email, necessidade, meta_lead_id, meta_ad_id, data_conversao, anotacoes")
    .eq("id", paraId)
    .single();
  const origem = de as CardDoForm | null;
  if (!origem?.meta_lead_id) return { ok: false, erro: "card de origem sem formulario" };
  if (!para) return { ok: false, erro: "card de destino nao existe" };
  if (para.meta_lead_id) return { ok: false, erro: "card de destino ja tem formulario" };

  const nota = `📋 Preencheu o formulário com outro número: ${origem.whatsapp ?? "não informado"}.`;
  const { error } = await supabase
    .from("leads")
    .update({
      meta_lead_id: origem.meta_lead_id,
      origem: "meta_ads",
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: origem.utm_campaign,
      utm_content: origem.utm_content,
      form_id: origem.form_id,
      page_id: origem.page_id,
      meta_ad_id: (para.meta_ad_id as string | null) ?? origem.meta_ad_id,
      email: (para.email as string | null) ?? (emailDoFormulario(origem.necessidade, origem.email) || null),
      necessidade: (para.necessidade as string | null) ?? origem.necessidade,
      data_conversao: (para.data_conversao as string | null) ?? origem.data_conversao,
      anotacoes: [para.anotacoes as string | null, nota].filter(Boolean).join("\n"),
    })
    .eq("id", paraId)
    .is("meta_lead_id", null);
  if (error) return { ok: false, erro: `db:${error.code ?? ""}:${error.message}` };

  // O que ja foi devolvido para a Meta por este formulario acompanha o
  // identificador; sem isso o "Lead Recebido" seria enviado de novo. Linha
  // que bate com uma ja existente no destino fica onde esta.
  const { data: envios } = await supabase.from("ads_conversions").select("id").eq("lead_id", deId);
  for (const linha of envios ?? []) {
    await supabase.from("ads_conversions").update({ lead_id: paraId }).eq("id", linha.id as string);
  }
  await supabase.from("leads").update({ meta_lead_id: null }).eq("id", deId);
  return { ok: true };
}
