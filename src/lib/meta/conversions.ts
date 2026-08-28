// Meta Conversions API (CRM) - devolve estagios do funil para a Meta.
// SERVER-ONLY.
//
// Equivalente ao que fazemos no Google Ads, com dois contrastes:
//
// 1. O identificador e o `leadgen_id` do Lead Ads, nao um id de clique.
//    So funciona para leads de formulario instantaneo.
// 2. Os nomes de evento sao livres - a Meta espera os estagios do SEU CRM,
//    e recomenda enviar todos, para o algoritmo aprender a progressao.
//
// https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration

const PIXEL_ID = process.env.META_CRM_PIXEL_ID;
const TOKEN = process.env.META_CRM_ACCESS_TOKEN;
const VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

// Nomes dos estagios como aparecem no Events Manager. Livres por definicao,
// entao configuraveis - mudar aqui sem mudar la quebra o casamento.
export const META_EVENT_NAMES = {
  qualificado: process.env.META_EVENT_QUALIFICADO ?? "Lead Qualificado",
  fechado: process.env.META_EVENT_FECHADO ?? "Venda Fechada",
};

export function metaConfigured(): boolean {
  return Boolean(PIXEL_ID && TOKEN);
}

export async function enviarEventoMeta(opts: {
  leadId: string; // leadgen_id da Meta
  eventName: string;
  eventTime: Date;
  value?: number;
  currency?: string;
  eventId: string; // deduplicacao do lado da Meta
}): Promise<{ ok: boolean; error?: string }> {
  if (!metaConfigured()) {
    return { ok: false, error: "Meta CRM não configurado." };
  }

  const evento: Record<string, unknown> = {
    event_name: opts.eventName,
    // Unix em segundos, e precisa ser posterior a geracao do lead.
    event_time: Math.floor(opts.eventTime.getTime() / 1000),
    // Evento vindo de sistema, nao de navegacao - dispensa user agent e URL.
    action_source: "system_generated",
    event_id: opts.eventId,
    user_data: { lead_id: opts.leadId },
  };

  // A documentacao de CRM nao confirma se valor e moeda sao considerados
  // nesses eventos. Enviamos porque nao atrapalha: se a Meta ignorar, o
  // evento vale do mesmo jeito para o aprendizado.
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
