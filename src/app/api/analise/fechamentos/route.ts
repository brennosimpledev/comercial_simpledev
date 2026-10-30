import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fechamentos e o retorno de cada um para Meta e Google — somente leitura.
//
//   GET ?secret=...

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: leads, error } = await admin
    .from("leads")
    .select("id, nome, origem, estagio, status, valor_fechado, ja_cliente, meta_lead_id, ctwa_clid, gclid, gbraid, wbraid, updated_at")
    .or("estagio.eq.fechado,status.eq.ganho")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (leads ?? []).map((l) => l.id as string);
  const { data: conv } = await admin
    .from("ads_conversions")
    .select("lead_id, tipo, canal, status, valor, uploaded_at, erro")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  return NextResponse.json({
    fechamentos: (leads ?? []).map((l) => ({
      id: l.id,
      nome: l.nome,
      origem: l.origem,
      estagio: l.estagio,
      valor_fechado: l.valor_fechado,
      ja_cliente: l.ja_cliente,
      id_meta: Boolean(l.meta_lead_id || l.ctwa_clid),
      id_google: Boolean(l.gclid || l.gbraid || l.wbraid),
      envios: (conv ?? [])
        .filter((c) => c.lead_id === l.id)
        .map((c) => `${c.canal}/${c.tipo}: ${c.status}${c.valor ? ` R$${c.valor}` : ""}${c.erro ? ` (${String(c.erro).slice(0, 80)})` : ""}`),
    })),
  });
}
