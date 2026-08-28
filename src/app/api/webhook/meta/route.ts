import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { scheduleFollowUpsForLead } from "@/lib/followups/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAPH = `https://graph.facebook.com/${
  process.env.META_GRAPH_VERSION ?? "v21.0"
}`;

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

interface LeadFieldDatum {
  name: string;
  values: string[];
}

function mapFields(fieldData: LeadFieldDatum[] = []) {
  const m: Record<string, string> = {};
  for (const f of fieldData) m[f.name] = (f.values ?? []).join(", ");
  return m;
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
      if (!token) {
        console.error("[webhook/meta] META_PAGE_ACCESS_TOKEN nao configurado");
        skipped.push("META_PAGE_ACCESS_TOKEN_ausente");
        continue;
      }

      // Busca os dados completos do lead na Graph API.
      let lead: {
        field_data?: LeadFieldDatum[];
        created_time?: string;
        campaign_name?: string;
        adset_name?: string;
        ad_name?: string;
        platform?: string;
      } | null = null;
      try {
        const res = await fetch(
          `${GRAPH}/${leadgenId}?fields=field_data,created_time,campaign_name,adset_name,ad_name,platform&access_token=${encodeURIComponent(
            token
          )}`
        );
        lead = await res.json();
        if (!res.ok) {
          console.error("[webhook/meta] graph error:", lead);
          const gErr = (lead as { error?: { message?: string; code?: number } })
            ?.error;
          skipped.push(
            `graph_${res.status}:${gErr?.code ?? "?"}:${gErr?.message ?? "erro"}`
          );
          continue;
        }
      } catch (e) {
        console.error("[webhook/meta] graph fetch failed:", e);
        skipped.push("graph_fetch_falhou");
        continue;
      }

      const f = mapFields(lead?.field_data);
      const nome =
        f.full_name ||
        f.name ||
        [f.first_name, f.last_name].filter(Boolean).join(" ") ||
        "Lead Meta";
      const email = f.email || null;
      const whatsapp = f.phone_number || f.phone || null;

      // Campos personalizados (perguntas do formulario) -> necessidade.
      const known = new Set([
        "full_name",
        "name",
        "first_name",
        "last_name",
        "email",
        "phone_number",
        "phone",
      ]);
      const extras = Object.entries(f)
        .filter(([k]) => !known.has(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");

      const { data: inserted, error } = await supabase
        .from("leads")
        .insert({
          nome,
          email,
          whatsapp,
          origem: "meta_ads",
          // Coluna propria: e o identificador que devolve a conversao a Meta.
          meta_lead_id: leadgenId,
          necessidade: extras || null,
          estagio: "novo",
          status: "ativo",
          utm_source: "meta",
          utm_medium: "paid",
          utm_campaign: lead?.campaign_name ?? null,
          utm_content: lead?.ad_name ?? null,
          referral_source: lead?.platform ?? null,
          data_conversao: lead?.created_time ?? null,
          form_id: (value.form_id as string) ?? null,
          page_id: (value.page_id as string) ?? entry.id ?? null,
          raw_payload: { leadgen: value, lead } as Record<string, unknown>,
        })
        .select("id, nome, created_at")
        .single();

      if (error) {
        console.error("[webhook/meta] insert error:", error);
        skipped.push(`db:${error.code ?? ""}:${error.message}`);
        continue;
      }

      try {
        await scheduleFollowUpsForLead(supabase, inserted);
      } catch {
        /* nao bloqueia */
      }
      processed++;
    }
  }

  return NextResponse.json({ ok: true, processed, skipped });
}
