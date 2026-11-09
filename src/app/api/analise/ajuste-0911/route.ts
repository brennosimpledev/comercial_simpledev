import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reenviarPendentes, reportConversion } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARIA (09/11/2026): marca qualificados e desqualificados do fim de
// semana, pedido pelo Brenno, e reenvia as desqualificacoes que falharam por
// card gemeo. Remover logo depois de rodar.
//
//   GET ?secret=...            -> so mostra o que faria
//   GET ?secret=...&aplicar=1  -> aplica

const DESDE = "2026-11-06T21:00:00Z";
const QUALIFICAR = ["Fernando S.A.", "Paulo Marques"];
const DESQUALIFICAR = [
  "Isamire Andrade",
  "Sue Guimarães",
  "José Pimentel",
  "Sandro Piragini",
  "Junio Gomes Dias",
  "Thiago Feitosa Bezerra",
  "Ronaldo Luis de Almeida",
];
const REENVIAR = ["Gustavo Silva | Síndico", "Gustavo Silva", "Cristiano brisa"];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const aplicar = q.get("aplicar") === "1";
  const admin = createAdminClient();

  const { data: doFds } = await admin
    .from("leads")
    .select("id, nome, estagio, status, qualificado, desqualificado, ja_cliente")
    .gte("created_at", DESDE)
    .in("nome", [...QUALIFICAR, ...DESQUALIFICAR]);
  const { data: falhas } = await admin
    .from("ads_conversions")
    .select("lead_id, leads!inner(nome)")
    .eq("tipo", "desqualificado")
    .in("status", ["erro", "sem_lead_id"])
    .gte("created_at", "2026-11-09T00:00:00Z");
  const reenviar = [
    ...new Set(
      ((falhas ?? []) as unknown as { lead_id: string; leads: { nome: string } }[])
        .filter((f) => REENVIAR.includes(f.leads.nome))
        .map((f) => f.lead_id)
    ),
  ];

  const feito: Record<string, unknown>[] = [];
  for (const l of doFds ?? []) {
    if (l.ja_cliente) continue;
    const qualifica = QUALIFICAR.includes(l.nome as string);
    feito.push({ nome: l.nome, estagio: l.estagio, acao: qualifica ? "qualificado" : "desqualificado" });
    if (!aplicar) continue;
    if (qualifica) {
      await admin.from("leads").update({ qualificado: true, desqualificado: false }).eq("id", l.id);
      await reportConversion(l.id as string, "qualificado");
    } else {
      // Mesmo efeito do botao no CRM: nenhum destes passou pela reuniao,
      // entao vai para Perdido.
      await admin
        .from("leads")
        .update({ desqualificado: true, qualificado: false, status: "perdido", estagio: "perdido" })
        .eq("id", l.id);
      await reportConversion(l.id as string, "desqualificado");
    }
  }
  if (aplicar) for (const id of reenviar) await reenviarPendentes(id);

  const ids = [...(doFds ?? []).map((l) => l.id as string), ...reenviar];
  const { data: retorno } = await admin
    .from("ads_conversions")
    .select("lead_id, tipo, canal, status, erro, leads!inner(nome)")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: true });

  return NextResponse.json({
    aplicado: aplicar,
    leads: feito,
    reenviar,
    retorno: ((retorno ?? []) as unknown as { tipo: string; canal: string; status: string; erro: string | null; leads: { nome: string } }[]).map(
      (r) => `${r.leads.nome}: ${r.tipo}/${r.canal} ${r.status}${r.erro ? ` (${r.erro.slice(0, 80)})` : ""}`
    ),
  });
}
