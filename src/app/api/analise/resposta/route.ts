import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tempo de primeira resposta e o que ele custa em reuniao — somente leitura.
//
//   GET ?secret=...&dias=90
//
// Para cada lead: quando chegou, quanto demorou ate a primeira mensagem
// nossa, se ele respondeu depois disso e se virou reuniao. Agrupa por
// faixa de demora e por janela de chegada (horario comercial ou fora).

const FAIXAS: { ate: number; rotulo: string }[] = [
  { ate: 5, rotulo: "1_ate_5min" },
  { ate: 30, rotulo: "2_ate_30min" },
  { ate: 60, rotulo: "3_ate_1h" },
  { ate: 240, rotulo: "4_ate_4h" },
  { ate: 1440, rotulo: "5_ate_24h" },
  { ate: Infinity, rotulo: "6_mais_de_24h" },
];

function faixaDe(minutos: number) {
  return FAIXAS.find((f) => minutos <= f.ate)!.rotulo;
}

// Comercial = segunda a sexta, 9h as 18h, horario de Brasilia.
function janelaDe(iso: string) {
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dia = d.getDay();
  const hora = d.getHours();
  if (dia === 0 || dia === 6) return "fim_de_semana";
  if (hora >= 9 && hora < 18) return "comercial";
  if (hora >= 18 && hora < 24) return "noite";
  return "madrugada";
}

type Bloco = {
  leads: number;
  responderam: number;
  reuniao: number;
  qualificados: number;
  sem_contato: number;
};

const novo = (): Bloco => ({
  leads: 0,
  responderam: 0,
  reuniao: 0,
  qualificados: 0,
  sem_contato: 0,
});

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const q = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 90);
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const { data: leads, error } = await admin
    .from("leads")
    .select("id, created_at, origem, qualificado, estagio")
    .gte("created_at", inicio)
    .eq("ja_cliente", false);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (leads ?? []).map((l) => l.id);
  if (ids.length === 0) return NextResponse.json({ dias, leads: 0 });

  // Mensagens e reunioes de todos esses leads, em paginas de 1000.
  const msgs: { lead_id: string; direction: string; created_at: string }[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await admin
      .from("lead_messages")
      .select("lead_id, direction, created_at")
      .in("lead_id", ids)
      .order("created_at", { ascending: true })
      .range(i, i + 999);
    if (!data || data.length === 0) break;
    msgs.push(...data);
    if (data.length < 1000) break;
  }

  const { data: mtgs } = await admin
    .from("meetings")
    .select("lead_id, status")
    .in("lead_id", ids);

  const temReuniao = new Set((mtgs ?? []).map((m) => m.lead_id));

  const porLead = new Map<string, { out?: string; inDepois?: boolean }>();
  for (const m of msgs) {
    const atual = porLead.get(m.lead_id) ?? {};
    if (m.direction === "outbound") {
      if (!atual.out) atual.out = m.created_at;
    } else if (atual.out && !atual.inDepois) {
      // Resposta do lead depois do nosso primeiro contato.
      atual.inDepois = true;
    }
    porLead.set(m.lead_id, atual);
  }

  const porFaixa: Record<string, Bloco> = {};
  const porJanela: Record<string, Bloco> = {};
  let somaMinutos = 0;
  let comContato = 0;

  for (const l of leads ?? []) {
    const info = porLead.get(l.id) ?? {};
    const janela = janelaDe(l.created_at as string);
    const bj = (porJanela[janela] ??= novo());
    bj.leads++;

    if (!info.out) {
      bj.sem_contato++;
      const bf = (porFaixa["0_sem_contato"] ??= novo());
      bf.leads++;
      bf.sem_contato++;
      if (temReuniao.has(l.id)) bf.reuniao++;
      if (l.qualificado) bf.qualificados++;
      continue;
    }

    const minutos = Math.max(
      0,
      (new Date(info.out).getTime() - new Date(l.created_at as string).getTime()) / 60000
    );
    somaMinutos += minutos;
    comContato++;

    const bf = (porFaixa[faixaDe(minutos)] ??= novo());
    bf.leads++;
    if (info.inDepois) {
      bf.responderam++;
      bj.responderam++;
    }
    if (temReuniao.has(l.id)) {
      bf.reuniao++;
      bj.reuniao++;
    }
    if (l.qualificado) {
      bf.qualificados++;
      bj.qualificados++;
    }
  }

  const comTaxas = (r: Record<string, Bloco>) =>
    Object.fromEntries(
      Object.entries(r)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [
          k,
          {
            ...v,
            taxa_resposta: v.leads ? `${((v.responderam / v.leads) * 100).toFixed(1)}%` : "-",
            taxa_reuniao: v.leads ? `${((v.reuniao / v.leads) * 100).toFixed(1)}%` : "-",
          },
        ])
    );

  return NextResponse.json({
    dias,
    leads: leads?.length ?? 0,
    media_minutos_ate_primeiro_contato: comContato
      ? Math.round(somaMinutos / comContato)
      : null,
    por_demora_do_primeiro_contato: comTaxas(porFaixa),
    por_janela_de_chegada: comTaxas(porJanela),
  });
}
