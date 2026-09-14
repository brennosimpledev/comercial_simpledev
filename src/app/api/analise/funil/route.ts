import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Funil por origem em janelas de 14 dias — somente leitura.
//
//   GET ?secret=...&dias=14&janelas=3
//
// Devolve, por origem e janela: leads, qualificados, desqualificados,
// reunioes e quantos tem identificador de clique do Google.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const q = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 14);
  const janelas = Math.min(Number(request.nextUrl.searchParams.get("janelas") ?? 3), 8);
  const agora = Date.now();
  const inicio = new Date(agora - dias * janelas * 86_400_000).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .select(
      "origem, created_at, qualificado, desqualificado, estagio, gclid, gbraid, wbraid, utm_term, utm_campaign, utm_content"
    )
    .gte("created_at", inicio)
    .eq("ja_cliente", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tabela: Record<string, Record<string, number>> = {};
  const termosGoogle: Record<string, { leads: number; qualif: number }> = {};
  const campanhasMeta: Record<string, { leads: number; qualif: number; desqualif: number }> = {};

  for (const l of data ?? []) {
    const idade = (agora - new Date(l.created_at as string).getTime()) / 86_400_000;
    const j = Math.floor(idade / dias);
    const rotulo = `${String(j + 1)}_${j * dias}-${(j + 1) * dias}d`;
    const chave = `${l.origem}|${rotulo}`;
    const t = (tabela[chave] ??= {
      leads: 0,
      qualificados: 0,
      desqualificados: 0,
      reuniao_ou_mais: 0,
      com_id_google: 0,
    });
    t.leads++;
    if (l.qualificado) t.qualificados++;
    if (l.desqualificado) t.desqualificados++;
    if (["reuniao_marcada", "proposta", "fechado"].includes(l.estagio as string))
      t.reuniao_ou_mais++;
    if (l.gclid || l.gbraid || l.wbraid) t.com_id_google++;

    if (l.origem === "meta_ads") {
      const chaveCamp = `${String(l.utm_campaign ?? "(sem campanha)")} | ${String(l.utm_content ?? "(sem anuncio)")}|${rotulo}`;
      const c = (campanhasMeta[chaveCamp] ??= { leads: 0, qualif: 0, desqualif: 0 });
      c.leads++;
      if (l.qualificado) c.qualif++;
      if (l.desqualificado) c.desqualif++;
    }

    if (l.origem === "google_ads" && j === 0) {
      const termo = String(l.utm_term ?? "(sem termo)");
      const g = (termosGoogle[termo] ??= { leads: 0, qualif: 0 });
      g.leads++;
      if (l.qualificado) g.qualif++;
    }
  }

  const linhas = Object.entries(tabela)
    .map(([k, v]) => {
      const [origem, janela] = k.split("|");
      return { origem, janela, ...v };
    })
    .sort((a, b) => (a.origem + a.janela).localeCompare(b.origem + b.janela));

  return NextResponse.json({
    dias,
    janelas,
    linhas,
    termos_google_janela_atual: termosGoogle,
    meta_por_campanha: campanhasMeta,
  });
}
