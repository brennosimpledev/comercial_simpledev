import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { desqualificarLead } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARIA (16/11/2026): desqualifica os leads do fim de semana que
// disseram nao ter o investimento, e o Joao Paulo Simas (sem negocio, sem
// orcamento, recusou a reuniao por video). Pedido do Brenno. Remover logo
// depois de rodar.
//
//   GET ?secret=...            -> so mostra o que faria
//   GET ?secret=...&aplicar=1  -> aplica

const IDS = [
  "3e6bd2c8-95da-4b1c-9731-bd38b9f022c0", // Joao Paulo Simas
  "acd03407-9770-4fc0-b236-ba5c60d14a11", // Livia Maria ("uns 3 mil")
  "0626b941-1e48-42cb-87c5-046e9bfdf77c", // Anderson Luiz ("muito caro")
  "2bf1a514-3555-4575-a54d-a9c56fdd914c", // Lucas Nascimento ("ate 5 mil")
  "062392ce-5604-4c54-b6d8-f55a82fa8974", // Jose Carlos De Melo (conversa)
  "5e09c804-f528-418d-b258-92eacd84d050", // José Carlos Melo (card do formulario)
];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const aplicar = q.get("aplicar") === "1";
  const admin = createAdminClient();

  const { data: leads } = await admin.from("leads").select("id, nome, estagio, desqualificado").in("id", IDS);
  const feito = [];
  for (const l of leads ?? []) {
    feito.push({ nome: l.nome, de: l.estagio, ja_estava: l.desqualificado });
    if (aplicar) await desqualificarLead(l.id as string);
  }

  const { data: retorno } = await admin
    .from("ads_conversions")
    .select("tipo, canal, status, erro, leads!inner(nome)")
    .in("lead_id", IDS)
    .eq("tipo", "desqualificado");

  return NextResponse.json({
    aplicado: aplicar,
    leads: feito,
    retorno: ((retorno ?? []) as unknown as { tipo: string; canal: string; status: string; erro: string | null; leads: { nome: string } }[]).map(
      (r) => `${r.leads.nome}: ${r.tipo}/${r.canal} ${r.status}${r.erro ? ` (${r.erro.slice(0, 80)})` : ""}`
    ),
  });
}
