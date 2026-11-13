// WhatsApp do CLOSER pela Evolution. SERVER-ONLY.
//
// Mesmo servidor da linha do SDR, outra instancia (NOME_DA_INSTANCIA.closer).
// Usa a chave global, que vale para qualquer instancia; a EVOLUTION_API_KEY
// e so da instancia do SDR.

import { toWaNumber, variantesBR, type EvoHistMessage, type SendTextResult } from "./client";
import { NOME_DA_INSTANCIA } from "./instancias";

const BASE = process.env.EVOLUTION_API_URL;
const CHAVE = process.env.EVOLUTION_GLOBAL_API_KEY || process.env.EVOLUTION_API_KEY;
const INSTANCIA = NOME_DA_INSTANCIA.closer;

export function closerConfigurado() {
  return Boolean(BASE && CHAVE && INSTANCIA);
}

async function post(caminho: string, corpo: unknown) {
  const res = await fetch(`${BASE}${caminho}/${encodeURIComponent(INSTANCIA)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CHAVE ?? "" },
    body: JSON.stringify(corpo),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const dados = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, dados };
}

function falha(status: number, dados: Record<string, unknown>): string {
  if (status === 404) return "WhatsApp do closer não está criado na Evolution. Conecte em Configurações.";
  const resp = dados.response as { message?: unknown } | undefined;
  const msg = JSON.stringify(resp?.message ?? dados.message ?? dados).slice(0, 200);
  if (/connection closed|not connected|close/i.test(msg)) {
    return "WhatsApp do closer desconectado. Conecte de novo em Configurações.";
  }
  return `Evolution respondeu ${status}: ${msg}`;
}

async function enviar(caminho: string, numeroBruto: string, corpo: Record<string, unknown>): Promise<SendTextResult> {
  if (!closerConfigurado()) return { ok: false, error: "Evolution não configurada." };
  const number = toWaNumber(numeroBruto);
  if (!number) return { ok: false, error: "Número de WhatsApp inválido." };
  try {
    const r = await post(caminho, { number, ...corpo });
    if (!r.ok) return { ok: false, error: falha(r.status, r.dados) };
    const key = r.dados.key as { id?: string } | undefined;
    return { ok: true, waMessageId: key?.id, raw: r.dados };
  } catch (e) {
    return { ok: false, error: `Falha ao chamar a Evolution: ${String(e)}` };
  }
}

export function enviarTextoCloser(numero: string, text: string) {
  return enviar("/message/sendText", numero, { text });
}

export function enviarMidiaCloser(
  numero: string,
  m: { mediatype: "image" | "video" | "document"; base64: string; mimetype: string; fileName: string; caption?: string }
) {
  return enviar("/message/sendMedia", numero, {
    mediatype: m.mediatype,
    mimetype: m.mimetype,
    media: m.base64,
    fileName: m.fileName,
    caption: m.caption ?? "",
  });
}

export function enviarAudioCloser(numero: string, base64: string) {
  return enviar("/message/sendWhatsAppAudio", numero, { audio: base64 });
}

// A Evolution guarda as mensagens no banco dela: com o id ela acha a
// mensagem e devolve a midia, sem precisarmos guardar o payload inteiro.
export async function midiaDoCloser(waMessageId: string): Promise<{ base64: string; mimetype: string } | null> {
  if (!closerConfigurado()) return null;
  try {
    const r = await post("/chat/getBase64FromMediaMessage", { message: { key: { id: waMessageId } }, convertToMp4: false });
    const base64 = r.dados.base64 as string | undefined;
    if (!r.ok || !base64) return null;
    return { base64, mimetype: (r.dados.mimetype as string | undefined) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

const POR_PAGINA = 50;

// Historico da conversa com o numero no WhatsApp do closer. Usa o primeiro
// jid que tiver mensagem (com ou sem o nono digito) para nao misturar
// conversas de numeros parecidos.
export async function historicoDoCloser(numero: string, maxPaginas = 4): Promise<EvoHistMessage[]> {
  if (!closerConfigurado()) return [];
  const jids = variantesBR(numero).map((n) => `${n}@s.whatsapp.net`);
  const pagina = async (jid: string, page: number) => {
    try {
      const r = await post("/chat/findMessages", { where: { key: { remoteJid: jid } }, page, offset: POR_PAGINA });
      if (!r.ok) return { registros: [] as EvoHistMessage[], paginas: 0 };
      const m = r.dados.messages as { records?: EvoHistMessage[]; pages?: number } | EvoHistMessage[] | undefined;
      if (Array.isArray(m)) return { registros: m, paginas: 1 };
      return { registros: m?.records ?? [], paginas: m?.pages ?? 1 };
    } catch {
      return { registros: [] as EvoHistMessage[], paginas: 0 };
    }
  };

  for (const jid of jids) {
    const primeira = await pagina(jid, 1);
    if (primeira.registros.length === 0) continue;
    const todas = [...primeira.registros];
    for (let p = 2; p <= Math.min(maxPaginas, primeira.paginas); p++) {
      const { registros } = await pagina(jid, p);
      todas.push(...registros);
      if (registros.length < POR_PAGINA) break;
    }
    return todas;
  }
  return [];
}
