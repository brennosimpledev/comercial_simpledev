import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// O que a Meta diz ter recebido no conjunto de dados do CRM — somente
// leitura. Compara com o que o CRM registrou como enviado.
//
//   GET ?secret=...&desde=2026-11-16T03:00:00Z

const PIXEL_ID = process.env.META_CRM_PIXEL_ID;
const TOKEN = process.env.META_CRM_ACCESS_TOKEN;
const VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const desde = q.get("desde") ?? new Date(Date.now() - 86_400_000).toISOString();
  const inicio = Math.floor(new Date(desde).getTime() / 1000);

  // Contagem por evento direto da Meta.
  let meta: unknown = null;
  let erroMeta: string | null = null;
  try {
    const p = new URLSearchParams({ aggregation: "event", start_time: String(inicio), access_token: TOKEN ?? "" });
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${PIXEL_ID}/stats?${p}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) erroMeta = `${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 400)}`;
    else meta = j;
  } catch (e) {
    erroMeta = String(e).slice(0, 300);
  }

  // O que o CRM registrou no mesmo periodo.
  const { data: crm } = await createAdminClient()
    .from("ads_conversions")
    .select("tipo, canal, status, erro, created_at, leads!inner(nome)")
    .gte("created_at", desde)
    .eq("canal", "meta")
    .order("created_at", { ascending: true });

  return NextResponse.json({
    desde,
    meta_erro: erroMeta,
    meta,
    crm: ((crm ?? []) as unknown as { tipo: string; status: string; erro: string | null; created_at: string; leads: { nome: string } }[]).map(
      (c) => `${new Date(c.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${c.leads.nome} · ${c.tipo} · ${c.status}${c.erro ? ` (${c.erro.slice(0, 120)})` : ""}`
    ),
  });
}
