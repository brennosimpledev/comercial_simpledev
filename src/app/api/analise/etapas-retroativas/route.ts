import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportarEtapa } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARIO (30/10): manda para a Meta as etapas que os leads de
// formulario ja percorreram antes de o CRM enviar etapas. So o que e fato:
// reuniao marcada/realizada pelas reunioes, e o estagio atual. Remover
// depois de usar.
//
//   POST { secret, ensaio: true }  -> lista o que mandaria
//   POST { secret }                -> manda

const ETAPAS_DO_CLOSER = ["reuniao_feita", "escopo_enviado", "apresentacao_marcada", "negociacao", "proposta", "interesse", "fechado"];

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const secret = process.env.CRON_SECRET;
  if (!secret || corpo.secret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: leads } = await admin
    .from("leads")
    .select("id, nome, estagio")
    .not("meta_lead_id", "is", null)
    .eq("ja_cliente", false)
    .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString());

  const ids = (leads ?? []).map((l) => l.id as string);
  const reunioes = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("meetings").select("lead_id, status").in("lead_id", ids.slice(i, i + 100));
    for (const m of data ?? []) {
      reunioes.set(m.lead_id as string, [...(reunioes.get(m.lead_id as string) ?? []), m.status as string]);
    }
  }

  const plano: { id: string; nome: string; estagios: string[] }[] = [];
  for (const l of leads ?? []) {
    const ms = reunioes.get(l.id as string) ?? [];
    const estagio = l.estagio as string;
    const doCloser = ETAPAS_DO_CLOSER.includes(estagio);
    const estagios: string[] = [];
    if (ms.length > 0 || estagio === "reuniao_marcada" || doCloser) estagios.push("reuniao_marcada");
    if (ms.includes("realizada") || doCloser) estagios.push("reuniao_feita");
    if (["escopo_enviado", "apresentacao_marcada", "negociacao", "proposta", "interesse"].includes(estagio)) {
      estagios.push(estagio);
    }
    if (estagios.length) plano.push({ id: l.id as string, nome: l.nome as string, estagios: [...new Set(estagios)] });
  }

  const contagem: Record<string, number> = {};
  for (const p of plano) for (const e of p.estagios) contagem[e] = (contagem[e] ?? 0) + 1;

  if (corpo.ensaio) return NextResponse.json({ ensaio: true, leads: plano.length, contagem });

  let enviados = 0;
  for (const p of plano) {
    // Em ordem: a Meta le a progressao do lead pelo funil.
    for (const e of p.estagios) {
      await reportarEtapa(p.id, e);
      enviados++;
    }
  }
  const { data: conv } = await admin
    .from("ads_conversions")
    .select("tipo, status")
    .eq("canal", "meta")
    .in("tipo", ["reuniao_marcada", "reuniao_realizada", "escopo_enviado", "apresentacao_marcada", "negociacao", "interesse"]);
  const resultado: Record<string, number> = {};
  for (const c of conv ?? []) resultado[`${c.tipo}:${c.status}`] = (resultado[`${c.tipo}:${c.status}`] ?? 0) + 1;
  return NextResponse.json({ enviados, resultado });
}
