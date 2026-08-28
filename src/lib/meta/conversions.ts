// Meta Conversions API - devolve estagios do funil para a Meta. SERVER-ONLY.
//
// Sao dois caminhos, com regras diferentes, dependendo de como o lead chegou:
//
// 1. Lead Ads de formulario instantaneo -> identificador `lead_id`
//    (o leadgen_id), action_source `system_generated`. Nomes de evento sao
//    LIVRES: a Meta espera os estagios do seu CRM.
//
// 2. Anuncio Click-to-WhatsApp -> identificador `ctwa_clid`, action_source
//    `business_messaging`. Nomes de evento sao PADRONIZADOS - mandar um nome
//    livre aqui devolve "tipo de evento invalido".
//
// https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging

const PIXEL_ID = process.env.META_CRM_PIXEL_ID;
const TOKEN = process.env.META_CRM_ACCESS_TOKEN;
const VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

export type ConversionType = "qualificado" | "fechado";

// Caminho CRM: nomes livres, entao configuraveis. Precisam bater com o que
// esta registrado no Gerenciador de Eventos.
const CRM_EVENT_NAMES: Record<ConversionType, string> = {
  qualificado: process.env.META_EVENT_QUALIFICADO ?? "Lead Qualificado",
  fechado: process.env.META_EVENT_FECHADO ?? "Venda Fechada",
};

// Caminho Click-to-WhatsApp: conjunto fechado definido pela Meta. Nao e
// configuravel de proposito - qualquer outro valor e recusado na hora.
const CTWA_EVENT_NAMES: Record<ConversionType, string> = {
  qualificado: "QualifiedLead",
  fechado: "Purchase",
};

export function metaConfigured(): boolean {
  return Boolean(PIXEL_ID && TOKEN);
}

export async function enviarEventoMeta(opts: {
  tipo: ConversionType;
  /** leadgen_id do Lead Ads. Tem prioridade quando os dois existem. */
  leadId?: string | null;
  /** Identificador de clique do Click-to-WhatsApp. */
  ctwaClid?: string | null;
  eventTime: Date;
  value?: number;
  currency?: string;
  eventId: string; // deduplicacao do lado da Meta
}): Promise<{ ok: boolean; error?: string }> {
  if (!metaConfigured()) {
    return { ok: false, error: "Meta CRM não configurado." };
  }

  const viaCrm = Boolean(opts.leadId);
  if (!viaCrm && !opts.ctwaClid) {
    return { ok: false, error: "Sem lead_id nem ctwa_clid." };
  }

  const evento: Record<string, unknown> = {
    event_name: viaCrm
      ? CRM_EVENT_NAMES[opts.tipo]
      : CTWA_EVENT_NAMES[opts.tipo],
    // Unix em segundos, e precisa ser posterior a geracao do lead.
    event_time: Math.floor(opts.eventTime.getTime() / 1000),
    event_id: opts.eventId,
  };

  if (viaCrm) {
    // Evento vindo de sistema, nao de navegacao - dispensa user agent e URL.
    evento.action_source = "system_generated";
    evento.user_data = { lead_id: opts.leadId };
  } else {
    evento.action_source = "business_messaging";
    evento.messaging_channel = "whatsapp";
    // ctwa_clid nao e hasheado, diferente dos demais identificadores.
    evento.user_data = { ctwa_clid: opts.ctwaClid };
  }

  if (typeof opts.value === "number" && opts.value > 0) {
    evento.custom_data = {
      value: opts.value,
      currency: opts.currency ?? "BRL",
    };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${VERSION}/${PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Token no corpo, e nao na query, para nao vazar em log de URL.
        body: JSON.stringify({ data: [evento], access_token: TOKEN }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      const e = data?.error;
      const partes = [
        String(res.status),
        e?.type ?? "",
        e?.message ?? JSON.stringify(data),
        e?.error_user_msg ?? "",
      ].filter(Boolean);
      return { ok: false, error: partes.join(" | ").slice(0, 900) };
    }

    // A Meta responde 200 com events_received: 0 quando descarta tudo.
    if (data?.events_received === 0) {
      return {
        ok: false,
        error: `nenhum evento aceito: ${JSON.stringify(data).slice(0, 600)}`,
      };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
}
