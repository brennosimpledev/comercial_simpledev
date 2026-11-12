import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brCanonical, last8 } from "@/lib/phone";
import { mediaKind, messageBody } from "@/lib/whatsapp-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recebe as mensagens do WhatsApp do CLOSER (segunda instancia da Evolution).
// Configure nessa instancia o webhook apontando para:
//   POST https://SEU_DOMINIO/api/webhook/whatsapp-closer?token=<WHATSAPP_WEBHOOK_SECRET>
// Evento necessario: MESSAGES_UPSERT.
//
// NUNCA aponte essa instancia para /api/webhook/whatsapp: aquele e o da
// linha do SDR, cria lead para numero desconhecido e aciona o bot. Este aqui
// so guarda, em closer_messages (migration 0022), a conversa com numero que
// JA e lead. Contato pessoal, grupo e numero desconhecido sao ignorados; nao
// cria lead, nao responde, nao mexe em lead_messages.

interface EvoKey {
  remoteJid?: string;
  remoteJidAlt?: string;
  fromMe?: boolean;
  id?: string;
}
interface EvoData {
  key?: EvoKey;
  message?: Record<string, unknown>;
  messageTimestamp?: number;
}

function keyToDigits(key?: EvoKey): string | null {
  if (!key) return null;
  const candidate =
    (key.remoteJid?.endsWith("@s.whatsapp.net") && key.remoteJid) ||
    (key.remoteJidAlt?.endsWith("@s.whatsapp.net") && key.remoteJidAlt) ||
    null;
  if (!candidate) return null;
  const digits = candidate.split("@")[0]?.replace(/\D/g, "") || "";
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();

  // Diferente do webhook do SDR, aqui o segredo e obrigatorio: sem ele
  // configurado, nada e aceito.
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const provided = request.headers.get("x-webhook-secret") ?? request.nextUrl.searchParams.get("token");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { event?: string; data?: EvoData | EvoData[] };
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const event = (payload.event ?? "").toLowerCase();
  if (!event.includes("messages") || !event.includes("upsert")) {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  const supabase = createAdminClient();
  let guardadas = 0;
  let ignoradas = 0;

  for (const data of items) {
    const digits = keyToDigits(data?.key);
    if (!data || !digits) {
      ignoradas++;
      continue;
    }

    const { data: candidatos } = await supabase
      .from("leads")
      .select("id, whatsapp, created_at")
      .like("whatsapp_digits", `%${last8(digits)}`)
      .order("created_at", { ascending: false })
      .limit(10);
    const lead = (candidatos ?? []).find((c) => brCanonical(c.whatsapp as string | null) === brCanonical(digits));
    // Nao e lead: conversa pessoal do closer. Nao guarda nada.
    if (!lead) {
      ignoradas++;
      continue;
    }

    const tipo = mediaKind(data.message);
    const { error } = await supabase.from("closer_messages").insert({
      lead_id: lead.id,
      direction: data.key?.fromMe ? "outbound" : "inbound",
      body: messageBody(data.message) || null,
      media_type: tipo,
      wa_message_id: data.key?.id ?? null,
      sent_at: data.messageTimestamp ? new Date(data.messageTimestamp * 1000).toISOString() : new Date().toISOString(),
    });
    // 23505: a Evolution reenviou a mesma mensagem.
    if (error && error.code !== "23505") {
      console.error("[webhook/whatsapp-closer]", error.message);
      continue;
    }
    if (!error) guardadas++;
  }

  return NextResponse.json({ ok: true, guardadas, ignoradas });
}
