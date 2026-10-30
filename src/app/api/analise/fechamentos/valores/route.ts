import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarFechamentoPendente, reportConversion } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARIO (30/10): grava os valores dos fechamentos que o bug do valor
// zerou e manda o fechamento para a Meta. Remover depois de usar.
//
//   POST { secret, itens: [{ id, valor }] }

const PERMITIDOS = new Set([
  "e041fc98-ce59-4149-99d1-ea905fa30e9a",
  "f23b6da9-51ec-49d4-aee6-4ca339713969",
  "1b2e06c4-41e5-4316-a2f0-b611984583a8",
  "afc56955-939a-4de2-bd1b-ad924c3fefb7",
  "ce43aafb-e4bd-4eb6-977e-3a68da6ba72a",
]);

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const secret = process.env.CRON_SECRET;
  if (!secret || corpo.secret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const feitos = [];
  for (const { id, valor } of (corpo.itens ?? []) as { id: string; valor: number }[]) {
    if (!PERMITIDOS.has(id) || !(valor > 0)) continue;
    const { error } = await admin.from("leads").update({ valor_fechado: valor }).eq("id", id);
    if (error) {
      feitos.push({ id, erro: error.message });
      continue;
    }
    await enviarFechamentoPendente(id);
    const { count } = await admin
      .from("ads_conversions")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", id)
      .eq("tipo", "fechado");
    if (!count) await reportConversion(id, "fechado");
    feitos.push({ id, valor });
  }
  return NextResponse.json({ feitos });
}
