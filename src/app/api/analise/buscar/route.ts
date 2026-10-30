import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Busca de lead por nome — somente leitura.
//
//   GET ?secret=...&nome=darius

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const nome = (q.get("nome") ?? "").trim();
  if (nome.length < 3) return NextResponse.json({ error: "nome curto demais" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .select("id, nome, origem, estagio, status, valor_fechado, ja_cliente, meta_lead_id, ctwa_clid, gclid, created_at, updated_at")
    .ilike("nome", `%${nome}%`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((l) => l.id as string);
  const { data: reunioes } = await admin
    .from("meetings")
    .select("lead_id, status, starts_at")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  return NextResponse.json({
    leads: (data ?? []).map((l) => ({
      ...l,
      meta_lead_id: Boolean(l.meta_lead_id),
      ctwa_clid: Boolean(l.ctwa_clid),
      gclid: Boolean(l.gclid),
      reunioes: (reunioes ?? []).filter((r) => r.lead_id === l.id).map((r) => `${r.status} ${String(r.starts_at).slice(0, 10)}`),
    })),
  });
}
