import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mapWebhookToLead,
  type LpWebhookPayload,
} from "@/lib/mappers/webhook-lead";
import { scheduleFollowUpsForLead } from "@/lib/followups/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A LP faz um fetch cross-origin com Content-Type: application/json, o que
// dispara um preflight CORS. Sem estes headers o navegador bloqueia o POST.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

// Responde ao preflight CORS.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// POST https://crm.simpledev.com.br/api/webhook/lead
// Header esperado (se LEAD_WEBHOOK_SECRET estiver setado):
//   x-webhook-secret: <segredo>  (ou ?token= na URL)
export async function POST(request: NextRequest) {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (secret) {
    // Aceita o segredo via header (preferencial) ou via ?token= (fallback
    // para plataformas de LP que nao permitem header customizado).
    const provided =
      request.headers.get("x-webhook-secret") ??
      request.nextUrl.searchParams.get("token");
    if (provided !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  let payload: LpWebhookPayload;
  try {
    payload = (await request.json()) as LpWebhookPayload;
  } catch {
    return json({ error: "invalid json" }, 400);
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
    return json({ error: "could not save lead" }, 500);
  }

  // Agenda a regua de follow-up (nao bloqueia a resposta se falhar).
  try {
    await scheduleFollowUpsForLead(supabase, data);
  } catch (e) {
    console.error("[webhook/lead] followup schedule error:", e);
  }

  return json({ ok: true, id: data.id }, 201);
}

// Health-check simples (GET) para testar se a rota esta no ar.
export async function GET() {
  return json({ ok: true, endpoint: "webhook/lead" });
}
