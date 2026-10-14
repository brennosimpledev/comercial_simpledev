import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quantas mensagens uma conversa precisa para virar reuniao — leitura.
//
//   GET ?secret=...&dias=150
//
// Para cada lead: mensagens nossas e do cliente ate a reuniao ser criada
// (ou ate a conversa acabar, quando nao houve reuniao). Responde se o teto
// de mensagens do bot cabe no tamanho real das conversas que dao certo.

function percentil(v: number[], p: number) {
  if (v.length === 0) return null;
  const ord = [...v].sort((a, b) => a - b);
  return ord[Math.min(ord.length - 1, Math.floor((ord.length - 1) * p))];
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const q = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 150);
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const msgs: {
    lead_id: string;
    direction: string;
    created_at: string;
    raw: Record<string, unknown> | null;
  }[] = [];
  for (let i = 0; i < 40000; i += 1000) {
    const { data } = await admin
      .from("lead_messages")
      .select("lead_id, direction, created_at, raw")
      .gte("created_at", inicio)
      .order("created_at", { ascending: true })
      .range(i, i + 999);
    if (!data || data.length === 0) break;
    msgs.push(...data);
    if (data.length < 1000) break;
  }

  const { data: mtgs } = await admin
    .from("meetings")
    .select("lead_id, created_at")
    .gte("created_at", inicio);

  // Primeira reuniao de cada lead.
  const primeiraReuniao = new Map<string, number>();
  for (const m of mtgs ?? []) {
    const t = new Date(m.created_at as string).getTime();
    const atual = primeiraReuniao.get(m.lead_id as string);
    if (!atual || t < atual) primeiraReuniao.set(m.lead_id as string, t);
  }

  const porLead = new Map<
    string,
    { nossas: number; deles: number; nossasAteReuniao: number; delesAteReuniao: number }
  >();

  for (const m of msgs) {
    const reg =
      porLead.get(m.lead_id) ??
      { nossas: 0, deles: 0, nossasAteReuniao: 0, delesAteReuniao: 0 };
    const nossa = m.direction === "outbound";
    if (nossa) reg.nossas++;
    else reg.deles++;

    const marco = primeiraReuniao.get(m.lead_id);
    if (marco && new Date(m.created_at).getTime() <= marco) {
      if (nossa) reg.nossasAteReuniao++;
      else reg.delesAteReuniao++;
    }
    porLead.set(m.lead_id, reg);
  }

  const comReuniao: number[] = [];
  const nossasComReuniao: number[] = [];
  const semReuniao: number[] = [];

  for (const [leadId, r] of porLead) {
    if (primeiraReuniao.has(leadId)) {
      comReuniao.push(r.nossasAteReuniao + r.delesAteReuniao);
      nossasComReuniao.push(r.nossasAteReuniao);
    } else {
      semReuniao.push(r.nossas + r.deles);
    }
  }

  // Quantas reunioes teriam cabido num teto X de mensagens nossas.
  const cabem = (teto: number) =>
    nossasComReuniao.filter((n) => n <= teto).length;

  return NextResponse.json({
    dias,
    conversas: porLead.size,
    com_reuniao: comReuniao.length,
    sem_reuniao: semReuniao.length,
    ate_a_reuniao: {
      total_mediana: percentil(comReuniao, 0.5),
      total_p75: percentil(comReuniao, 0.75),
      total_p90: percentil(comReuniao, 0.9),
      nossas_mediana: percentil(nossasComReuniao, 0.5),
      nossas_p75: percentil(nossasComReuniao, 0.75),
      nossas_p90: percentil(nossasComReuniao, 0.9),
    },
    sem_reuniao_mediana: percentil(semReuniao, 0.5),
    reunioes_que_caberiam_no_teto: {
      "3_mensagens": cabem(3),
      "6_mensagens": cabem(6),
      "10_mensagens": cabem(10),
      "15_mensagens": cabem(15),
      "20_mensagens": cabem(20),
      total: nossasComReuniao.length,
    },
  });
}
