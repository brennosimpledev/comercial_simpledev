// Texto da transcricao de uma reuniao do Meet. SERVER-ONLY.
//
// Usa o link salvo na reuniao (Google Docs ou arquivo .txt/.vtt) ou, sem
// link, procura no Drive pelo nome do lead perto da data da reuniao.

import { findMeetFiles } from "./drive";

async function exportarDoc(token: string, docId: string, max: number): Promise<string | null> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return null;
  return (await r.text()).replace(/\s+\n/g, "\n").slice(0, max);
}

export async function textoDaTranscricao(
  token: string | null,
  reuniao: { transcricao: string | null; starts_at: string },
  leadNome: string,
  max = 60_000
): Promise<string | null> {
  try {
    const link = reuniao.transcricao;
    const doc = link?.match(/\/document\/d\/([\w-]+)/)?.[1];
    if (doc && token) return await exportarDoc(token, doc, max);
    if (link && /\.(txt|vtt|srt)(\?|$)/i.test(link)) {
      const r = await fetch(link, { signal: AbortSignal.timeout(20_000) });
      return r.ok ? (await r.text()).slice(0, max) : null;
    }
    if (!token) return null;
    const achados = await findMeetFiles(token, { leadNome, startsAt: reuniao.starts_at });
    const t = achados.files?.find((f) => f.tipo === "transcricao");
    return t ? await exportarDoc(token, t.id, max) : null;
  } catch (e) {
    console.error("[transcricao]", e);
    return null;
  }
}
