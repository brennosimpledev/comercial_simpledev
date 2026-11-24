import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Como a campanha de formulario da Meta esta configurada DE FATO — somente
// leitura. A tela de edicao do Gerenciador de Anuncios mostra o conjunto de
// dados e o evento de conversao em branco para conjunto ja publicado, e nao
// da para saber por ela se a otimizacao por lead qualificado esta ligada ao
// dataset do CRM. A API devolve o promoted_object real.
//
//   GET ?secret=...                 conjuntos, o que otimizam e gasto por dia
//   GET ?secret=...&historico=1     tambem o que foi alterado na conta
//   GET ?secret=...&desde=2026-10-01

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

async function ler(caminho: string, token: string) {
  const sep = caminho.includes("?") ? "&" : "?";
  try {
    const r = await fetch(`${GRAPH}/${caminho}${sep}access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return { erro: `${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 400)}` };
    return j as Record<string, unknown>;
  } catch (e) {
    return { erro: String(e).slice(0, 300) };
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.META_ADS_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ erro: "Falta META_ADS_ACCESS_TOKEN na Vercel." });

  const desde = q.get("desde") ?? new Date(Date.now() - 55 * 86_400_000).toISOString().slice(0, 10);
  const ate = new Date().toISOString().slice(0, 10);

  const contas = (await ler("me/adaccounts?fields=id,name,account_status&limit=50", token)) as {
    data?: { id: string; name: string }[];
    erro?: string;
  };
  if (contas.erro) return NextResponse.json({ erro: contas.erro });

  const saida = [];
  for (const conta of contas.data ?? []) {
    const conjuntos = await ler(
      `${conta.id}/adsets?fields=id,name,effective_status,optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,attribution_spec,targeting{geo_locations,age_min,age_max,custom_audiences,targeting_automation},updated_time,created_time,campaign{id,name,objective,daily_budget,effective_status,updated_time}&limit=50`,
      token
    );
    const periodo = encodeURIComponent(JSON.stringify({ since: desde, until: ate }));
    const porDia = await ler(
      `${conta.id}/insights?level=account&time_increment=1&time_range=${periodo}&fields=spend,impressions,reach,frequency,cpm,actions&limit=100`,
      token
    );
    const item: Record<string, unknown> = { conta, conjuntos, porDia };
    if (q.get("historico") === "1") {
      item.historico = await ler(
        `${conta.id}/activities?fields=event_time,event_type,translated_event_type,object_name,object_type,extra_data,actor_name&since=${desde}&until=${ate}&limit=300`,
        token
      );
    }
    saida.push(item);
  }

  const pixel = process.env.META_CRM_PIXEL_ID;
  const dataset = pixel
    ? await ler(`${pixel}?fields=id,name,is_unavailable,last_fired_time,event_stats`, process.env.META_CRM_ACCESS_TOKEN ?? token)
    : null;

  return NextResponse.json({ desde, ate, pixel_do_crm: pixel, dataset, contas: saida });
}
