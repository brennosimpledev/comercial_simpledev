import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppText, evolutionConfigured } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disparado pelo Vercel Cron (ver vercel.json).
// Envia os follow-ups pendentes cujo horario ja chegou, respeitando
// "bot pausado" e leads desqualificados/fechados.
export async function GET(request: NextRequest) {
  // Vercel Cron envia Authorization: Bearer <CRON_SECRET> quando a env existe.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!evolutionConfigured()) {
    return NextResponse.json({ ok: true, skipped: "evolution not configured" });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("follow_ups")
    .select(
      "id, body, lead_id, leads!inner(whatsapp, bot_pausado, desqualificado, estagio)"
    )
    .eq("status", "pendente")
    .lte("scheduled_at", now)
    .limit(25);

  if (error) {
    console.error("[cron/followups]", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const fu of due ?? []) {
    const lead = (fu as unknown as {
      leads: {
        whatsapp: string | null;
        bot_pausado: boolean;
        desqualificado: boolean;
        estagio: string;
      };
    }).leads;

    const stop =
      lead.bot_pausado ||
      lead.desqualificado ||
      lead.estagio === "fechado" ||
      lead.estagio === "perdido" ||
      !lead.whatsapp;

    if (stop) {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelado" })
        .eq("id", fu.id);
      skipped++;
      continue;
    }

    const result = await sendWhatsAppText(lead.whatsapp!, fu.body);

    await supabase.from("lead_messages").insert({
      lead_id: fu.lead_id,
      direction: "outbound",
      body: fu.body,
      wa_message_id: result.waMessageId ?? null,
      status: result.ok ? "sent" : "failed",
    });

    if (result.ok) {
      await supabase
        .from("follow_ups")
        .update({ status: "enviado", sent_at: new Date().toISOString() })
        .eq("id", fu.id);
      sent++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, total: due?.length ?? 0 });
}
