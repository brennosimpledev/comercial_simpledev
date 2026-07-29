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

async function findByJid(jid: string): Promise<EvoHistMessage[]> {
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

// Busca o historico de um contato tentando varios jids (variacoes do numero
// + jids extras, ex.: o @lid real capturado nas mensagens recebidas).
export async function fetchWhatsAppHistory(
  numberDigits: string,
  extraJids: string[] = []
): Promise<EvoHistMessage[]> {
  if (!evolutionConfigured()) return [];
  const jids = [
    ...brNumberVariants(numberDigits).map((n) => `${n}@s.whatsapp.net`),
    ...extraJids.filter(Boolean),
  ];

  const byId = new Map<string, EvoHistMessage>();
  for (const jid of jids) {
    const records = await findByJid(jid);
    for (const r of records) {
      const id = r?.key?.id;
      if (id && !byId.has(id)) byId.set(id, r);
    }
  }
  return Array.from(byId.values());
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
