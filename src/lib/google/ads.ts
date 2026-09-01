// Google Data Manager API - envio de conversoes offline. SERVER-ONLY.
//
// Este modulo so envia. Quem decide o que enviar, registra e trata
// idempotencia e `src/lib/conversions/report.ts`, que atende os dois canais.
//
// Por que Data Manager e nao Google Ads API: o
// ConversionUploadService.uploadClickConversions foi fechado para novas
// integracoes ("limited to existing users") e responde 404 NOT_FOUND em
// qualquer versao. O caminho atual e datamanager.googleapis.com.
// https://developers.google.com/data-manager/api/devguides/events/google-ads/offline

import { getTeamAccessToken } from "./tokens";

// Conta do Google Ads dona da acao de conversao (so digitos).
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/\D/g, "");
// Conta de administrador (MCC), quando a operacao passa por uma.
const LOGIN_CUSTOMER_ID =
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "");

const ACTION_IDS: Record<string, string | undefined> = {
  qualificado: process.env.GOOGLE_ADS_ACTION_QUALIFICADO,
  fechado: process.env.GOOGLE_ADS_ACTION_FECHADO,
};

// Declarar consentimento e uma afirmacao juridica sobre como o dado foi
// coletado, entao fica desligado por padrao e so vai se configurado.
const CONSENT_GRANTED = process.env.GOOGLE_ADS_CONSENT === "granted";

// Obrigatorio para conversao offline e ausente do exemplo da documentacao.
// Valores: WEB, APP, IN_STORE, PHONE, OTHER. OTHER e o mais honesto aqui: o
// evento nao e a visita ao site nem uma ligacao, e uma qualificacao
// registrada no CRM depois de uma call.
const EVENT_SOURCE = process.env.GOOGLE_ADS_EVENT_SOURCE ?? "OTHER";

const ENDPOINT = "https://datamanager.googleapis.com/v1/events:ingest";

// Ao contrario da Google Ads API, o Data Manager nao usa developer token.
export function googleConfigurado(): boolean {
  return Boolean(CUSTOMER_ID);
}

export async function enviarConversaoGoogle(opts: {
  gclid: string;
  tipo: "qualificado" | "fechado";
  eventTimestamp: string; // RFC 3339 em UTC
  value: number;
  currency: string;
  transactionId: string;
}): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  if (!googleConfigurado()) {
    return { ok: false, error: "Google Ads não configurado." };
  }

  const actionId = ACTION_IDS[opts.tipo];
  if (!actionId) {
    return { ok: false, error: `Ação '${opts.tipo}' sem ID configurado.` };
  }

  const token = await getTeamAccessToken();
  if (!token) return { ok: false, error: "Nenhuma conta Google conectada." };

  const destino: Record<string, unknown> = {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: CUSTOMER_ID },
    productDestinationId: actionId,
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

    // Guardar o requestId e o que torna o erro de processamento
    // diagnosticavel depois - ver consultarStatusGoogle.
    return { ok: true, requestId: data?.requestId };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
}

/**
 * Resultado do processamento de um envio, que so existe depois da resposta.
 *
 * O ingest responde 200 quando aceita a requisicao; o casamento com os
 * cliques roda depois e pode rejeitar tudo. Sem esta consulta, um envio
 * 100% descartado aparece como sucesso do nosso lado.
 *
 * Disponivel ~30 min apos o envio. Antes disso volta PROCESSING.
 */
export async function consultarStatusGoogle(
  requestId: string
): Promise<{ ok: boolean; resumo?: string; pendente?: boolean; error?: string }> {
  const token = await getTeamAccessToken();
  if (!token) return { ok: false, error: "Nenhuma conta Google conectada." };

  const url =
    "https://datamanager.googleapis.com/v1/requestStatus:retrieve" +
    "?requestId=" +
    encodeURIComponent(requestId);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) {
      const e = data?.error;
      return {
        ok: false,
        error: [res.status, e?.status, e?.message].filter(Boolean).join(" | "),
      };
    }

    const destinos = data?.requestStatusPerDestination ?? [];
    if (destinos.length === 0) return { ok: true, pendente: true };

    const partes: string[] = [];
    let pendente = false;

    for (const d of destinos) {
      const st = d?.requestStatus ?? "DESCONHECIDO";
      if (st === "PROCESSING") pendente = true;

      const motivos = (d?.errorInfo?.errorCounts ?? [])
        .map((c: { reason?: string; recordCount?: string }) =>
          `${c.reason ?? "?"} x${c.recordCount ?? "?"}`
        )
        .join(", ");
      const avisos = (d?.warningInfo?.warningCounts ?? [])
        .map((c: { reason?: string; recordCount?: string }) =>
          `${c.reason ?? "?"} x${c.recordCount ?? "?"}`
        )
        .join(", ");

      partes.push(
        [st, motivos && `erros: ${motivos}`, avisos && `avisos: ${avisos}`]
          .filter(Boolean)
          .join(" | ")
      );
    }

    return { ok: true, resumo: partes.join(" // ").slice(0, 900), pendente };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
}
