import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mapWebhookToLead,
  type LpWebhookPayload,
} from "@/lib/mappers/webhook-lead";
import { scheduleFollowUpsForLead } from "@/lib/followups/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST https://crm.simpledev.com.br/api/webhook/lead
// Header esperado (se LEAD_WEBHOOK_SECRET estiver setado):
//   x-webhook-secret: <segredo>
export async function POST(request: NextRequest) {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (secret) {
    // Aceita o segredo via header (preferencial) ou via ?token= (fallback
    // para plataformas de LP que nao permitem header customizado).
    const provided =
      request.headers.get("x-webhook-secret") ??
      request.nextUrl.searchParams.get("token");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: LpWebhookPayload;
  try {
    payload = (await request.json()) as LpWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const lead = mapWebhookToLead(payload);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .insert(lead)
    .select("id, nome, created_at")
    .single();

  if (error) {
    console.error("[webhook/lead] insert error:", error);
    return NextResponse.json(
      { error: "could not save lead" },
      { status: 500 }
    );
  }

  // Agenda a regua de follow-up (nao bloqueia a resposta se falhar).
  try {
    await scheduleFollowUpsForLead(supabase, data);
  } catch (e) {
    console.error("[webhook/lead] followup schedule error:", e);
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

// Health-check simples (GET) para testar se a rota esta no ar.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "webhook/lead" });
}
