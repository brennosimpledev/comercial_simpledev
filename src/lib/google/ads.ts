// Google Data Manager API - envio de conversoes offline. SERVER-ONLY.
//
// Fecha o ciclo do funil: quando o SDR marca um lead como qualificado ou o
// lead e fechado, devolvemos essa conversao ao Google Ads via gclid. O Smart
// Bidding passa a otimizar para cliques que viram negocio, e nao para volume
// de formulario.
//
// Por que Data Manager e nao Google Ads API: o
// ConversionUploadService.uploadClickConversions foi fechado para novas
// integracoes ("limited to existing users") e responde 404 NOT_FOUND. O
// caminho atual e datamanager.googleapis.com/v1/events:ingest.
// https://developers.google.com/data-manager/api/devguides/events/google-ads/offline

import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamAccessToken } from "./tokens";

export type ConversionType = "qualificado" | "fechado";

// Conta do Google Ads dona da acao de conversao (so digitos).
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/\D/g, "");
// Conta de administrador (MCC), quando a operacao passa por uma.
const LOGIN_CUSTOMER_ID =
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "");

const ACTION_IDS: Record<ConversionType, string | undefined> = {
  qualificado: process.env.GOOGLE_ADS_ACTION_QUALIFICADO,
  fechado: process.env.GOOGLE_ADS_ACTION_FECHADO,
};

// Valor atribuido a um lead qualificado (nao ha valor real ainda; serve para
// o algoritmo ter um sinal economico consistente).
const VALOR_QUALIFICADO = Number(
  process.env.GOOGLE_ADS_VALOR_QUALIFICADO ?? "200"
);
// Usado quando o lead fecha mas ninguem preencheu o valor do contrato.
const VALOR_FECHADO_PADRAO = Number(
  process.env.GOOGLE_ADS_VALOR_FECHADO_PADRAO ?? "0"
);

// Declarar consentimento e uma afirmacao juridica sobre como o dado foi
// coletado, entao fica desligado por padrao e so vai se configurado.
const CONSENT_GRANTED = process.env.GOOGLE_ADS_CONSENT === "granted";

// Obrigatorio para conversao offline. Valores: WEB, APP, IN_STORE, PHONE,
// OTHER. OTHER e o mais honesto aqui: o evento nao e a visita ao site nem uma
// ligacao, e uma qualificacao registrada no CRM depois de uma call.
const EVENT_SOURCE = process.env.GOOGLE_ADS_EVENT_SOURCE ?? "OTHER";

const ENDPOINT = "https://datamanager.googleapis.com/v1/events:ingest";

// Ao contrario da Google Ads API, o Data Manager nao usa developer token.
export function adsConfigured(): boolean {
  return Boolean(CUSTOMER_ID);
}

export async function uploadClickConversion(opts: {
  gclid: string;
  actionId: string;
  eventTimestamp: string;
  value: number;
  currency: string;
  transactionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!adsConfigured()) {
    return { ok: false, error: "Google Ads não configurado." };
  }

  const token = await getTeamAccessToken();
  if (!token) return { ok: false, error: "Nenhuma conta Google conectada." };

  const destino: Record<string, unknown> = {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: CUSTOMER_ID },
    productDestinationId: opts.actionId,
  };
  if (LOGIN_CUSTOMER_ID) {
    destino.loginAccount = {
      accountType: "GOOGLE_ADS",
      accountId: LOGIN_CUSTOMER_ID,
    };
  }

  const body: Record<string, unknown> = {
    destinations: [destino],
    events: [
      {
        adIdentifiers: { gclid: opts.gclid },
        eventSource: EVENT_SOURCE,
        eventTimestamp: opts.eventTimestamp,
        conversionValue: opts.value,
        currency: opts.currency,
        transactionId: opts.transactionId,
      },
    ],
    validateOnly: false,
  };
  if (CONSENT_GRANTED) {
    body.consent = {
      adPersonalization: "CONSENT_GRANTED",
      adUserData: "CONSENT_GRANTED",
    };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      const e = data?.error;
      const partes = [
        String(res.status),
        e?.status ?? "",
        e?.message ?? JSON.stringify(data),
        Array.isArray(e?.details) ? JSON.stringify(e.details) : "",
      ].filter(Boolean);
      return { ok: false, error: partes.join(" | ").slice(0, 900) };
    }

    // A ingestao responde 200 com avisos por campo: dado aceito mas ignorado
    // continua sendo falha para o nosso proposito.
    if (Array.isArray(data?.fieldWarnings) && data.fieldWarnings.length > 0) {
      return {
        ok: false,
        error: `avisos: ${JSON.stringify(data.fieldWarnings).slice(0, 700)}`,
      };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
}

// Registra e envia a conversao de um lead. Idempotente: a unique
// (lead_id, tipo) faz o segundo insert falhar, e nada e reenviado.
// Nunca lanca - falha aqui nao pode quebrar a acao do CRM.
export async function reportConversion(
  leadId: string,
  tipo: ConversionType
): Promise<void> {
  try {
    if (!adsConfigured()) return;

    const admin = createAdminClient();
    const { data: lead } = await admin
      .from("leads")
      .select("id, gclid, valor_fechado, origem")
      .eq("id", leadId)
      .single();
    if (!lead) return;

    const agora = new Date();
    const valor =
      tipo === "fechado"
        ? Number(lead.valor_fechado ?? VALOR_FECHADO_PADRAO)
        : VALOR_QUALIFICADO;

    // O insert e a trava de idempotencia: se ja existe, o unique barra.
    // Fechamento sem valor fica em espera em vez de subir zerado: a unique
    // impede corrigir depois, entao um zero enviado agora seria permanente.
    const semValor = tipo === "fechado" && !(valor > 0);

    const { data: row, error: insErr } = await admin
      .from("ads_conversions")
      .insert({
        lead_id: leadId,
        tipo,
        gclid: lead.gclid,
        valor,
        conversion_at: agora.toISOString(),
        status: !lead.gclid
          ? "sem_gclid"
          : semValor
            ? "aguardando_valor"
            : "pendente",
      })
      .select("id")
      .single();

    if (insErr || !row) return; // ja enviado antes
    if (!lead.gclid) return; // lead nao veio de clique do Google Ads
    if (semValor) return; // sobe quando alguem preencher o valor do contrato

    const actionId = ACTION_IDS[tipo];
    if (!actionId) {
      await admin
        .from("ads_conversions")
        .update({ status: "erro", erro: `Ação '${tipo}' sem ID configurado.` })
        .eq("id", row.id);
      return;
    }

    const r = await uploadClickConversion({
      gclid: lead.gclid,
      actionId,
      // RFC 3339 em UTC, que e o formato aceito pelo Data Manager.
      eventTimestamp: agora.toISOString(),
      value: valor,
      currency: "BRL",
      // O id da nossa linha serve de chave de deduplicacao do lado do Google.
      transactionId: row.id,
    });

    await admin
      .from("ads_conversions")
      .update(
        r.ok
          ? { status: "enviado", uploaded_at: new Date().toISOString() }
          : { status: "erro", erro: r.error }
      )
      .eq("id", row.id);

    if (!r.ok) console.error("[ads] upload falhou:", r.error);
  } catch (e) {
    console.error("[ads] reportConversion:", e);
  }
}

// Envia o fechamento que ficou parado por falta de valor. Chamada quando
// alguem preenche valor_fechado num lead ja marcado como fechado.
export async function enviarFechamentoPendente(leadId: string): Promise<void> {
  try {
    if (!adsConfigured()) return;

    const admin = createAdminClient();

    const { data: row } = await admin
      .from("ads_conversions")
      .select("id, gclid")
      .eq("lead_id", leadId)
      .eq("tipo", "fechado")
      .eq("status", "aguardando_valor")
      .maybeSingle();
    if (!row?.gclid) return;

    const { data: lead } = await admin
      .from("leads")
      .select("valor_fechado")
      .eq("id", leadId)
      .single();

    const valor = Number(lead?.valor_fechado ?? 0);
    if (!(valor > 0)) return; // ainda sem valor: segue esperando

    const actionId = ACTION_IDS.fechado;
    if (!actionId) return;

    const agora = new Date();
    const r = await uploadClickConversion({
      gclid: row.gclid,
      actionId,
      eventTimestamp: agora.toISOString(),
      value: valor,
      currency: "BRL",
      transactionId: row.id,
    });

    await admin
      .from("ads_conversions")
      .update(
        r.ok
          ? { status: "enviado", valor, uploaded_at: agora.toISOString() }
          : { status: "erro", valor, erro: r.error }
      )
      .eq("id", row.id);

    if (!r.ok) console.error("[ads] fechamento pendente falhou:", r.error);
  } catch (e) {
    console.error("[ads] enviarFechamentoPendente:", e);
  }
}
