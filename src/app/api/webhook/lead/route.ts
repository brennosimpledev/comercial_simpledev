import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mapWebhookToLead,
  type LpWebhookPayload,
} from "@/lib/mappers/webhook-lead";
import { scheduleFollowUpsForLead } from "@/lib/followups/schedule";
import { brCanonical, last8 } from "@/lib/phone";

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

  // A Ferramenta de Teste de Lead Ads da Meta manda campos literais como
  // "<test lead: dummy data for full_name>". Sao leads falsos e nao podem
  // entrar no funil.
  const texto = JSON.stringify(payload).toLowerCase();
  if (texto.includes("<test lead:") || texto.includes("dummy data for")) {
    return json({ ok: true, ignorado: "lead de teste da Meta" });
  }

  const lead = mapWebhookToLead(payload);

  const supabase = createAdminClient();

  // Procura lead existente pelo telefone antes de inserir.
  //
  // Sem isto, uma automacao reprocessando o historico cria uma copia de
  // cada lead que ja estava na base - foi o que aconteceu em 01/09/2026,
  // quando uma re-execucao gerou 40 duplicatas em um minuto. Mesmo criterio
  // dos webhooks da Meta e do WhatsApp: canonico BR, DDD + 8 digitos.
  const digitos = String(lead.whatsapp ?? "").replace(/[^0-9]/g, "");
  let existente: string | undefined;

  if (digitos.length >= 10) {
    const canon = brCanonical(digitos);
    const { data: candidatos } = await supabase
      .from("leads")
      .select("id, whatsapp")
      .like("whatsapp_digits", `%${last8(digitos)}`)
      .limit(10);
    existente = (candidatos ?? []).find(
      (c) => brCanonical(c.whatsapp) === canon
    )?.id;
  }

  if (existente) {
    // Completa so o rastreio que estiver faltando. Nunca toca em nome,
    // estagio, anotacoes ou valor: o SDR pode ja ter trabalhado o lead.
    const rastreio: Record<string, unknown> = {};
    for (const campo of [
      "gclid",
      "gbraid",
      "wbraid",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ] as const) {
      const v = (lead as Record<string, unknown>)[campo];
      if (v) rastreio[campo] = v;
    }

    if (Object.keys(rastreio).length) {
      await supabase.from("leads").update(rastreio).eq("id", existente);
    }

    return json({ ok: true, id: existente, acao: "atualizado" });
  }

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
