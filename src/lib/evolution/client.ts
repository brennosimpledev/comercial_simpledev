// Integracao com a Evolution API (WhatsApp). SERVER-ONLY.
// Docs: https://doc.evolution-api.com  (endpoints v2)

const BASE = process.env.EVOLUTION_API_URL; // ex: https://evo.suaempresa.com
const INSTANCE = process.env.EVOLUTION_INSTANCE; // nome da instancia
const API_KEY = process.env.EVOLUTION_API_KEY; // apikey da instancia

export function evolutionConfigured(): boolean {
  return Boolean(BASE && INSTANCE && API_KEY);
}

// Normaliza um numero para o formato que a Evolution espera (so digitos, com DDI).
// Assume Brasil (55) quando o numero nao tem DDI.
export function toWaNumber(raw: string): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

export interface EvoHistMessage {
  key?: {
    id?: string;
    fromMe?: boolean;
    remoteJid?: string;
    remoteJidAlt?: string;
  };
  message?: Record<string, unknown> | null;
  messageType?: string;
  messageTimestamp?: number | string;
  pushName?: string;
}

// Busca o historico de mensagens de um contato na Evolution.
export async function fetchWhatsAppHistory(
  numberDigits: string
): Promise<EvoHistMessage[]> {
  if (!evolutionConfigured()) return [];
  const jid = `${numberDigits}@s.whatsapp.net`;
  try {
    const res = await fetch(
      `${BASE}/chat/findMessages/${encodeURIComponent(INSTANCE!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY! },
        body: JSON.stringify({ where: { key: { remoteJid: jid } } }),
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      messages?: { records?: EvoHistMessage[] } | EvoHistMessage[];
    };
    const m = data?.messages;
    const records = Array.isArray(m) ? m : (m?.records ?? []);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export interface SendTextResult {
  ok: boolean;
  waMessageId?: string;
  error?: string;
}

// Envia uma mensagem de texto via Evolution API.
export async function sendWhatsAppText(
  toRaw: string,
  text: string
): Promise<SendTextResult> {
  if (!evolutionConfigured()) {
    return { ok: false, error: "Evolution API não configurada (env vars)." };
  }
  const number = toWaNumber(toRaw);
  if (!number) return { ok: false, error: "Número de WhatsApp inválido." };

  try {
    const res = await fetch(
      `${BASE}/message/sendText/${encodeURIComponent(INSTANCE!)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: API_KEY!,
        },
        body: JSON.stringify({ number, text }),
      }
    );

    const data = (await res.json().catch(() => ({}))) as {
      key?: { id?: string };
      message?: unknown;
    };

    if (!res.ok) {
      return {
        ok: false,
        error: `Evolution respondeu ${res.status}: ${JSON.stringify(data)}`,
      };
    }

    return { ok: true, waMessageId: data?.key?.id };
  } catch (e) {
    return { ok: false, error: `Falha ao chamar Evolution: ${String(e)}` };
  }
}
