import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARIO (30/10): registra o fechamento do Darius, que ficou no sistema
// antigo (R$ 37.800, pago em 17/08). So o CRM: a Meta nao aceita evento com
// mais de 7 dias. Remover depois de usar.

const ID = "758742a5-a761-42fc-95ab-892a24eb4ed2";

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const secret = process.env.CRON_SECRET;
  if (!secret || corpo.secret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: lead } = await admin.from("leads").select("anotacoes").eq("id", ID).single();
  const nota = "Fechado em 17/08/2026: projeto de R$ 37.800, pago em 17/08. Registrado em 30/10 a partir do sistema antigo.";
  const anotacoes = lead?.anotacoes ? `${nota}\n\n${lead.anotacoes}` : nota;
  const { error } = await admin
    .from("leads")
    .update({
      estagio: "fechado",
      status: "ganho",
      valor_fechado: 37800,
      estagio_em: "2026-08-17T12:00:00-03:00",
      anotacoes,
    })
    .eq("id", ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data } = await admin
    .from("leads")
    .select("nome, estagio, status, valor_fechado, estagio_em")
    .eq("id", ID)
    .single();
  return NextResponse.json({ ok: true, lead: data });
}
