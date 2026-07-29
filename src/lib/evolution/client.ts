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

// Gera variacoes do numero BR (com e sem o 9o digito).
function brNumberVariants(numberDigits: string): string[] {
  const set = new Set<string>([numberDigits]);
  if (numberDigits.startsWith("55") && numberDigits.length >= 12) {
    const ddd = numberDigits.slice(2, 4);
    const num = numberDigits.slice(4);
    if (num.length === 9 && num.startsWith("9")) {
      set.add("55" + ddd + num.slice(1)); // remove o 9
    } else if (num.length === 8) {
      set.add("55" + ddd + "9" + num); // adiciona o 9
    }
  }
  return Array.from(set);
}

const PAGE_SIZE = 50;

async function findByJidPage(
  jid: string,
  page: number
): Promise<{ records: EvoHistMessage[]; pages: number }> {
  try {
    const res = await fetch(
      `${BASE}/chat/findMessages/${encodeURIComponent(INSTANCE!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY! },
        body: JSON.stringify({
          where: { key: { remoteJid: jid } },
          page,
          offset: PAGE_SIZE,
        }),
      }
    );
    if (!res.ok) return { records: [], pages: 0 };
    const data = (await res.json()) as {
      messages?:
        | { records?: EvoHistMessage[]; pages?: number }
        | EvoHistMessage[];
    };
    const m = data?.messages;
    if (Array.isArray(m)) return { records: m, pages: 1 };
    return { records: m?.records ?? [], pages: m?.pages ?? 1 };
  } catch {
    return { records: [], pages: 0 };
  }
}

// Busca o historico de um contato. Escolhe o PRIMEIRO jid que retorna dados
// (prioridade: @lid definitivo > numero exato > variacoes) para nao misturar
// conversas de numeros parecidos, e pagina esse jid ate maxPages.
export async function fetchWhatsAppHistory(
  numberDigits: string,
  extraJids: string[] = [],
  maxPages = 1
): Promise<EvoHistMessage[]> {
  if (!evolutionConfigured()) return [];

  const candidates = [
    ...extraJids.filter(Boolean),
    `${numberDigits}@s.whatsapp.net`,
    ...brNumberVariants(numberDigits)
      .filter((n) => n !== numberDigits)
      .map((n) => `${n}@s.whatsapp.net`),
  ];

  const byId = new Map<string, EvoHistMessage>();
  let chosen: string | null = null;
  let pages = 1;

  for (const jid of candidates) {
    const first = await findByJidPage(jid, 1);
    if (first.records.length > 0) {
      chosen = jid;
      pages = first.pages || 1;
      for (const r of first.records) {
        const id = r?.key?.id;
        if (id && !byId.has(id)) byId.set(id, r);
      }
      break;
    }
  }
  if (!chosen) return [];

  for (let page = 2; page <= Math.min(maxPages, pages); page++) {
    const { records } = await findByJidPage(chosen, page);
    if (records.length === 0) break;
    for (const r of records) {
      const id = r?.key?.id;
      if (id && !byId.has(id)) byId.set(id, r);
    }
    if (records.length < PAGE_SIZE) break;
  }

  return Array.from(byId.values());
}

// Baixa a midia de uma mensagem (base64) via Evolution.
export async function getMediaBase64(
  message: unknown
): Promise<{ base64: string; mimetype: string } | null> {
  if (!evolutionConfigured()) return null;
  try {
    const res = await fetch(
      `${BASE}/chat/getBase64FromMediaMessage/${encodeURIComponent(INSTANCE!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY! },
        body: JSON.stringify({ message, convertToMp4: false }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      base64?: string;
      mimetype?: string;
    };
    if (!data?.base64) return null;
    return {
      base64: data.base64,
      mimetype: data.mimetype ?? "application/octet-stream",
    };
  } catch {
    return null;
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
