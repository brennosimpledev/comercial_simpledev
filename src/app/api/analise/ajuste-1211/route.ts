import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportConversion } from "@/lib/conversions/report";
import { CLOSER_STAGES, type LeadStage } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARIA (12/11/2026): desqualifica os leads de novembro que viraram
// "Lead Qualificado" sem orcamento confirmado e faltaram, cancelaram ou nao
// tem dinheiro, pedido pelo Brenno. Remover logo depois de rodar.
//
//   GET ?secret=...            -> so mostra o que faria
//   GET ?secret=...&aplicar=1  -> aplica

const IDS = [
  "dbaff537-da0b-4b27-a057-714f55421189", // Anderson mariano de Jesus
  "bb33394c-7e0b-4d76-8c58-2f7828cbb98c", // Sebastiao Francisco Chagas Filho
  "53bb8c31-e84d-40db-a5b8-06290c87e3e8", // FERNANDO ALMEIDA
  "167bcbbd-9e94-471c-8f14-bb4f9e7f2c5d", // Hilder Moncao
  "9ac07f8c-2ba9-4f34-9401-f4c688e276b6", // TV PELOURINHO
  "c7b2f7df-68de-480f-a626-65ff4f6059c5", // Paulo Marques
  "83e189bb-5556-4697-81a6-7e048710d8f3", // Junior Clube da resenha
  "d8a5e1ef-03d5-4262-ae2c-38fb8322f330", // Carlos Deda
  "c8574c33-ba2f-4961-9e94-f6dcbcbbbf3a", // Kledson Souza
];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const aplicar = q.get("aplicar") === "1";
  const admin = createAdminClient();

  const { data: leads } = await admin
    .from("leads")
    .select("id, nome, estagio, status, desqualificado, ja_cliente")
    .in("id", IDS);

  const feito = [];
  for (const l of leads ?? []) {
    if (l.ja_cliente) continue;
    // Mesmo efeito do botao no CRM: quem ja passou pela reuniao vai para a
    // coluna Desqualificado do closer; antes disso, para Perdido.
    const doCloser =
      [...CLOSER_STAGES, "proposta"].includes(l.estagio as LeadStage) && l.estagio !== "perdido";
    const estagio = doCloser ? "desqualificado" : "perdido";
    feito.push({ nome: l.nome, de: l.estagio, para: estagio });
    if (!aplicar) continue;
    await admin
      .from("leads")
      .update({ desqualificado: true, qualificado: false, status: "perdido", estagio })
      .eq("id", l.id);
    await reportConversion(l.id as string, "desqualificado");
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
