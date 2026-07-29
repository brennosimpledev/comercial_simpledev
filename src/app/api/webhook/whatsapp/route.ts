import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brCanonical, last8 } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recebe eventos da Evolution API (mensagens de WhatsApp).
// Configure na Evolution o webhook apontando para:
//   POST https://SEU_DOMINIO/api/webhook/whatsapp
// Evento necessario: MESSAGES_UPSERT.

interface EvoKey {
  remoteJid?: string;
  remoteJidAlt?: string; // numero real quando remoteJid vem como @lid
  fromMe?: boolean;
  id?: string;
}
interface EvoMessage {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  [k: string]: unknown;
}
interface EvoData {
  key?: EvoKey;
  pushName?: string;
  message?: EvoMessage;
  messageType?: string;
  messageTimestamp?: number;
}

function extractText(msg?: EvoMessage): string | null {
  if (!msg) return null;
  return msg.conversation ?? msg.extendedTextMessage?.text ?? null;
}

// Extrai os digitos do numero real do contato a partir da key.
// O WhatsApp novo pode mandar remoteJid como "<id>@lid" (ofuscado) e o
// numero real em remoteJidAlt. Ignora grupos/newsletters/status/broadcast.
function keyToDigits(key?: EvoKey): string | null {
  if (!key) return null;
  const candidate =
    (key.remoteJid?.endsWith("@s.whatsapp.net") && key.remoteJid) ||
    (key.remoteJidAlt?.endsWith("@s.whatsapp.net") && key.remoteJidAlt) ||
    null;
  if (!candidate) return null;
  const digits = candidate.split("@")[0]?.replace(/\D/g, "") || "";
  // Numero brasileiro/internacional plausivel (10 a 15 digitos).
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      request.headers.get("x-webhook-secret") ??
      request.nextUrl.searchParams.get("token");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: { event?: string; data?: EvoData | EvoData[] };
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = (payload.event ?? "").toLowerCase();
  // Aceita messages.upsert / messages_upsert.
  if (!event.includes("messages") || !event.includes("upsert")) {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  const supabase = createAdminClient();
  let processed = 0;

  for (const data of items) {
    if (!data) continue;
    const digits = keyToDigits(data.key);
    if (!digits) continue;

    const text = extractText(data.message);
    const fromMe = Boolean(data.key?.fromMe);
    const waMessageId = data.key?.id ?? null;
    const pushName = data.pushName ?? null;

    // Prefiltro barato pelos ultimos 8 digitos e confirmacao pelo numero
    // canonico (DDD + 8), evitando casar numeros de DDDs diferentes.
    const canon = brCanonical(digits);
    const { data: candidates } = await supabase
      .from("leads")
      .select("id, whatsapp")
      .like("whatsapp_digits", `%${last8(digits)}`)
      .limit(10);

    let leadId = (candidates ?? []).find(
      (c) => brCanonical(c.whatsapp as string | null) === canon
    )?.id as string | undefined;

    if (!leadId) {
      // Nao cria lead para mensagens que NOS enviamos a um numero desconhecido.
      if (fromMe) continue;
      const { data: created } = await supabase
        .from("leads")
        .insert({
          nome: pushName || `WhatsApp ${digits.slice(-4)}`,
          whatsapp: digits,
          origem: "whatsapp",
          estagio: "novo",
          status: "ativo",
        })
        .select("id")
        .single();
      leadId = created?.id;
    }

    if (!leadId) continue;

    // Evita duplicar a mesma mensagem (unique em wa_message_id).
    const { error: insErr } = await supabase.from("lead_messages").insert({
      lead_id: leadId,
      direction: fromMe ? "outbound" : "inbound",
      body: text,
      wa_message_id: waMessageId,
      status: fromMe ? "sent" : "received",
      raw: data as unknown as Record<string, unknown>,
    });

    // Se foi o CLIENTE que respondeu: marca que respondeu e para a regua.
    if (!fromMe && !insErr) {
      await supabase
        .from("leads")
        .update({ sem_resposta: false })
        .eq("id", leadId);
      await supabase
        .from("follow_ups")
        .update({ status: "cancelado" })
        .eq("lead_id", leadId)
        .eq("status", "pendente");
    }

    processed++;
  }

  return NextResponse.json({ ok: true, processed });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "webhook/whatsapp",
    version: "tz-hydration-fix",
  });
}
