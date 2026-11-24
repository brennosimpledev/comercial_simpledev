import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarLeadNaMeta, gravarLeadDaMeta, tokenDaPaginaReserva } from "@/lib/meta/leadgen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------- Verificacao do webhook (GET) --------
// O Meta chama esta URL com hub.challenge ao configurar o webhook.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

// -------- Recebimento de leads (POST) --------
export async function POST(request: NextRequest) {
  const raw = await request.text();

  // Validacao da assinatura (X-Hub-Signature-256), se o app secret existir.
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    const sig = request.headers.get("x-hub-signature-256") ?? "";
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  }

  let body: {
    object?: string;
    entry?: Array<{
      id?: string;
      changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
    }>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const supabase = createAdminClient();
  let processed = 0;
  // Motivos de descarte, devolvidos na resposta para facilitar o diagnostico
  // (a rota so chega aqui com assinatura valida).
  const skipped: string[] = [];
  let falhou = false;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") {
        skipped.push(`campo_ignorado:${change.field}`);
        continue;
      }
      const value = change.value ?? {};
      const leadgenId = value.leadgen_id as string | undefined;
      if (!leadgenId) {
        skipped.push("sem_leadgen_id");
        continue;
      }
      // Busca os dados completos do lead na Graph API e grava no CRM
      // (lib/meta/leadgen.ts, a mesma entrada que a rotina de conferencia usa).
      // Se o token da pagina falhar ou faltar, tenta com o de reserva (do
      // usuario de sistema) antes de desistir do lead.
      let busca: Awaited<ReturnType<typeof buscarLeadNaMeta>> = token
        ? await buscarLeadNaMeta(leadgenId, token)
        : { erro: "META_PAGE_ACCESS_TOKEN_ausente" };
      if ("erro" in busca) {
        const outro = await tokenDaPaginaReserva();
        if (outro && outro !== token) {
          const deNovo = await buscarLeadNaMeta(leadgenId, outro);
          if (!("erro" in deNovo)) {
            console.error(
              `[webhook/meta] META_PAGE_ACCESS_TOKEN falhou (${busca.erro}); o lead ${leadgenId} entrou pelo token de reserva. Renovar o token da pagina na Vercel.`
            );
          }
          busca = deNovo;
        }
      }
      if ("erro" in busca) {
        skipped.push(busca.erro);
        falhou = true;
        continue;
      }
      const r = await gravarLeadDaMeta(supabase, leadgenId, busca.lead, {
        ...value,
        page_id: (value.page_id as string) ?? entry.id ?? null,
      });
      if (!r.ok) {
        skipped.push(r.erro);
        falhou = true;
        continue;
      }
      processed++;
    }
  }

  // Continua respondendo 200 mesmo quando um lead falha: erro repetido faz a
  // Meta suspender o aviso. Quem garante que o lead que falhou aqui (ou cujo
  // aviso nunca chegou) entre no CRM e a rotina /api/cron/meta-leads, que
  // confere os formularios a cada 30 minutos.
  return NextResponse.json({ ok: !falhou, processed, skipped });
}
