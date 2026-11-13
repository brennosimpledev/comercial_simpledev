"use server";

// Conversa do lead no WhatsApp do CLOSER (painel do Funil).
//
// Fica em closer_messages, separada de lead_messages: o bot, a regua e a
// fila do SDR leem lead_messages, e mensagem do closer la mudaria o
// comportamento deles. A tabela nao tem policy, entao tudo passa pelo
// servidor com o usuario logado conferido.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarAudioCloser,
  enviarMidiaCloser,
  enviarTextoCloser,
  historicoDoCloser,
} from "@/lib/evolution/closer";
import type { SendTextResult } from "@/lib/evolution/client";
import { mediaKind, messageBody, type MediaKind } from "@/lib/whatsapp-message";

async function leadDoUsuario(leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login de novo." } as const;
  const { data: lead } = await supabase.from("leads").select("id, whatsapp").eq("id", leadId).single();
  if (!lead) return { error: "Lead não encontrado." } as const;
  if (!lead.whatsapp) return { error: "Lead sem número de WhatsApp." } as const;
  return { lead: lead as { id: string; whatsapp: string } };
}

async function registrar(
  leadId: string,
  r: SendTextResult,
  body: string,
  media: MediaKind | null
) {
  if (!r.ok) return { error: r.error ?? "Não foi possível enviar." };
  const { error } = await createAdminClient().from("closer_messages").insert({
    lead_id: leadId,
    direction: "outbound",
    body,
    media_type: media,
    wa_message_id: r.waMessageId ?? null,
    sent_at: new Date().toISOString(),
  });
  // 23505: o webhook da Evolution ja gravou essa mesma mensagem.
  if (error && error.code !== "23505") {
    console.error("[closer] registrar", error.message);
    return { ok: true, aviso: "Enviada, mas não ficou registrada no CRM." };
  }
  return { ok: true };
}

export async function enviarMensagemCloser(leadId: string, texto: string) {
  const body = texto.trim();
  if (!body) return { error: "Mensagem vazia." };
  const l = await leadDoUsuario(leadId);
  if ("error" in l) return l;
  return registrar(leadId, await enviarTextoCloser(l.lead.whatsapp, body), body, null);
}

export async function enviarMidiaDoCloser(
  leadId: string,
  m: { mediatype: "image" | "video" | "document"; base64: string; mimetype: string; fileName: string }
) {
  if (!m.base64) return { error: "Arquivo vazio." };
  const l = await leadDoUsuario(leadId);
  if ("error" in l) return l;
  const kind: MediaKind = m.mediatype;
  const body = kind === "document" ? m.fileName : "";
  return registrar(leadId, await enviarMidiaCloser(l.lead.whatsapp, m), body, kind);
}

export async function enviarAudioDoCloser(leadId: string, base64: string) {
  if (!base64) return { error: "Áudio vazio." };
  const l = await leadDoUsuario(leadId);
  if ("error" in l) return l;
  return registrar(leadId, await enviarAudioCloser(l.lead.whatsapp, base64), "", "audio");
}

// Traz o que ja foi conversado no WhatsApp do closer antes de ele estar
// conectado ao CRM (ou que o webhook perdeu).
export async function importarHistoricoCloser(leadId: string) {
  const l = await leadDoUsuario(leadId);
  if ("error" in l) return l;

  const historico = await historicoDoCloser(l.lead.whatsapp);
  const linhas = historico
    .filter((m) => m.key?.id)
    .map((m) => {
      const ts = Number(m.messageTimestamp);
      return {
        lead_id: leadId,
        direction: (m.key?.fromMe ? "outbound" : "inbound") as "outbound" | "inbound",
        body: messageBody(m.message) || null,
        media_type: mediaKind(m.message),
        wa_message_id: m.key!.id!,
        sent_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
      };
    })
    // Mensagem de sistema (reacao, apagada...) sem texto nem midia.
    .filter((r) => r.body || r.media_type);

  if (linhas.length === 0) return { ok: true, importadas: 0 };

  const admin = createAdminClient();
  const { data: ja } = await admin
    .from("closer_messages")
    .select("wa_message_id")
    .in("wa_message_id", linhas.map((r) => r.wa_message_id));
  const tem = new Set((ja ?? []).map((r) => r.wa_message_id as string));
  const novas = linhas.filter((r) => !tem.has(r.wa_message_id));
  if (novas.length === 0) return { ok: true, importadas: 0 };

  const { error } = await admin.from("closer_messages").insert(novas);
  if (error) {
    console.error("[closer] importar", error.message);
    return { error: "Não foi possível importar o histórico." };
  }
  return { ok: true, importadas: novas.length };
}
