// Google Ads API - upload de conversoes offline. SERVER-ONLY.
//
// Fecha o ciclo do funil: quando o SDR marca um lead como qualificado ou o
// lead e fechado, devolvemos essa conversao ao Google Ads via gclid. O Smart
// Bidding passa a otimizar para cliques que viram negocio, e nao para volume
// de formulario.

import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamAccessToken } from "./tokens";

export type ConversionType = "qualificado" | "fechado";

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/\D/g, "");
const LOGIN_CUSTOMER_ID =
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "");

// A API do Google Ads e versionada e versoes antigas sao desligadas.
// Em 24/08/2026 a faixa viva era v22..v26; v21 e anteriores ja respondiam
// 404 em HTML, o que quebra o parse do JSON. Ajuste pela env var.
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v26";

// Fuso da conta do Google Ads (Configuracoes da conta -> Fuso horario).
const TZ = process.env.GOOGLE_ADS_TIMEZONE ?? "America/Sao_Paulo";
const TZ_OFFSET = process.env.GOOGLE_ADS_TZ_OFFSET ?? "-03:00";

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

export function adsConfigured(): boolean {
  return Boolean(DEV_TOKEN && CUSTOMER_ID);
}

// Formato exigido pela API: "yyyy-MM-dd HH:mm:ss+|-HH:mm".
function adsDateTime(d: Date): string {
  // sv-SE ja produz "2026-08-24 14:30:00".
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  return `${s.replace(",", "")}${TZ_OFFSET}`;
}

export async function uploadClickConversion(opts: {
  gclid: string;
  actionId: string;
  conversionDateTime: string;
  value: number;
  currency: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!adsConfigured()) return { ok: false, error: "Google Ads não configurado." };

  const token = await getTeamAccessToken();
  if (!token) return { ok: false, error: "Nenhuma conta Google conectada." };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": DEV_TOKEN!,
    "Content-Type": "application/json",
  };
  if (LOGIN_CUSTOMER_ID) headers["login-customer-id"] = LOGIN_CUSTOMER_ID;

  const url =
    `https://googleads.googleapis.com/${API_VERSION}` +
    `/customers/${CUSTOMER_ID}:uploadClickConversions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversions: [
          {
            gclid: opts.gclid,
            conversionAction:
              `customers/${CUSTOMER_ID}/conversionActions/${opts.actionId}`,
            conversionDateTime: opts.conversionDateTime,
            conversionValue: opts.value,
            currencyCode: opts.currency,
          },
        ],
        partialFailure: true,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error?.message ?? JSON.stringify(data);
      return { ok: false, error: String(msg).slice(0, 500) };
    }
    // partialFailure: a requisicao volta 200 mesmo com a conversao recusada.
    if (data?.partialFailureError) {
      return {
        ok: false,
        error: String(data.partialFailureError.message ?? "").slice(0, 500),
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
}

// Registra e envia a conversao de um lead. Idempotente: a unique
// (lead_id, tipo) faz o segundo insert falhar, e nada e reenviado.
// Nunca lanca — falha aqui nao pode quebrar a acao do CRM.
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
    const { data: row, error: insErr } = await admin
      .from("ads_conversions")
      .insert({
        lead_id: leadId,
        tipo,
        gclid: lead.gclid,
        valor,
        conversion_at: agora.toISOString(),
        status: lead.gclid ? "pendente" : "sem_gclid",
      })
      .select("id")
      .single();

    if (insErr || !row) return; // ja enviado antes
    if (!lead.gclid) return; // lead nao veio de clique do Google Ads

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
      conversionDateTime: adsDateTime(agora),
      value: valor,
      currency: "BRL",
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
