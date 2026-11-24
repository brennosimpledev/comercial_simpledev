import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { atenderReuniao } from "@/lib/bot/reuniao";
import { brCanonical, last8 } from "@/lib/phone";
import { mediaKind, messageBody } from "@/lib/whatsapp-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O bot de reuniao espera o cliente terminar de escrever e chama a IA.
export const maxDuration = 60;

// Recebe as mensagens do WhatsApp do CLOSER (segunda instancia da Evolution).
// Configure nessa instancia o webhook apontando para:
//   POST https://SEU_DOMINIO/api/webhook/whatsapp-closer?token=<WHATSAPP_WEBHOOK_SECRET>
// Evento necessario: MESSAGES_UPSERT.
//
// NUNCA aponte essa instancia para /api/webhook/whatsapp: aquele e o da
// linha do SDR, cria lead para numero desconhecido e aciona o atendente. Este
// aqui guarda, em closer_messages (migration 0022), a conversa com numero que
// JA e lead. Contato pessoal, grupo e numero desconhecido sao ignorados; nao
// cria lead, nao mexe em lead_messages.
//
// O unico bot que escuta esta linha e o de reuniao: quem ja teve reuniao
// realizada recebe lembrete e confirmacao por aqui (lib/linha.ts), entao a
// resposta dele tambem chega por aqui. O bot so trata assunto de reuniao, so
// fala com quem tem reuniao em jogo e fica quieto se o closer esta na conversa.

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
  // Ultima mensagem do cliente por lead, para o bot de reuniao.
  const doCliente = new Map<string, string | null>();

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
    if (!error) {
      guardadas++;
      if (!data.key?.fromMe) doCliente.set(lead.id as string, data.key?.id ?? null);
    }
  }

  if (doCliente.size > 0) {
    after(async () => {
      await Promise.all(
        [...doCliente].map(([id, gatilho]) =>
          atenderReuniao(supabase, id, { gatilho, origem: "webhook", linha: "closer" })
        )
      );
    });
  }

  return NextResponse.json({ ok: true, guardadas, ignoradas });
}
