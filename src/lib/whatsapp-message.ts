// Helpers compartilhados para interpretar mensagens do WhatsApp (Evolution).

type Msg = Record<string, unknown>;

export type MediaKind = "image" | "audio" | "video" | "document" | "sticker";

// Detecta se a mensagem tem midia e de que tipo.
export function mediaKind(message: unknown): MediaKind | null {
  const m = (message ?? {}) as Msg;
  if (m.imageMessage) return "image";
  if (m.audioMessage) return "audio";
  if (m.videoMessage) return "video";
  if (m.documentMessage) return "document";
  if (m.stickerMessage) return "sticker";
  return null;
}

// Texto exibivel da mensagem (com marcadores para midia).
export function messageBody(message: unknown): string {
  const m = (message ?? {}) as Msg;
  const conv = m.conversation as string | undefined;
  if (conv) return conv;
  const ext = m.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return ext.text;
  const img = m.imageMessage as { caption?: string } | undefined;
  if (img) return img.caption ?? "";
  const vid = m.videoMessage as { caption?: string } | undefined;
  if (vid) return vid.caption ?? "";
  if (m.audioMessage) return "";
  const doc = m.documentMessage as { fileName?: string; caption?: string } | undefined;
  if (doc) return doc.fileName ?? doc.caption ?? "arquivo";
  if (m.stickerMessage) return "";
  if (m.locationMessage) return "[localização]";
  if (m.contactMessage) return "[contato]";
  return "";
}
