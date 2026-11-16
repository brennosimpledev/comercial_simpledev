import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Numeros de cada anuncio na Meta (gasto, CTR, leads, retencao do video) —
// somente leitura.
//
//   GET ?secret=...&preset=maximum   (ou last_14d, last_30d...)

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;
const CONTA = process.env.META_AD_ACCOUNT_ID ?? "act_1344489454200596";

type Acao = { action_type: string; value: string };
const soma = (lista: Acao[] | undefined, tipo: string) =>
  Number((lista ?? []).find((a) => a.action_type === tipo)?.value ?? 0);

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const preset = q.get("preset") ?? "maximum";

  // ?app=1: so diz a qual app da Meta cada token do CRM pertence (para
  // escolher o app certo ao gerar um token novo). Nao devolve o token.
  if (q.get("app") === "1") {
    const nomes: Record<string, string> = {
      META_CRM_ACCESS_TOKEN: process.env.META_CRM_ACCESS_TOKEN ?? "",
      META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN ?? "",
    };
    const apps: Record<string, unknown> = {};
    for (const [nome, token] of Object.entries(nomes)) {
      if (!token) continue;
      const r = await fetch(`${GRAPH}/app?fields=id,name&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      apps[nome] = r.ok ? j : { erro: (j as { error?: { message?: string } } | null)?.error?.message ?? r.status };
    }
    return NextResponse.json({ apps });
  }

  // Tenta os tokens que o CRM ja tem; o primeiro que ler a conta vale.
  const tokens = [
    process.env.META_ADS_ACCESS_TOKEN,
    process.env.META_CRM_ACCESS_TOKEN,
    process.env.META_PAGE_ACCESS_TOKEN,
  ].filter(Boolean) as string[];

  // ?contas=1: lista as contas de anuncio que o token de leitura enxerga.
  if (q.get("contas") === "1") {
    const token = process.env.META_ADS_ACCESS_TOKEN;
    if (!token) return NextResponse.json({ error: "META_ADS_ACCESS_TOKEN não configurado" });
    const r = await fetch(
      `${GRAPH}/me/adaccounts?fields=id,name,account_status,currency,amount_spent&limit=50&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    return NextResponse.json(r.ok ? { contas: j.data, padrao: CONTA } : { erro: j?.error?.message ?? r.status });
  }
  const erros: string[] = [];
  for (const token of tokens) {
    const campos = [
      "ad_id",
      "ad_name",
      "adset_name",
      "campaign_name",
      "spend",
      "impressions",
      "reach",
      "frequency",
      "clicks",
      "inline_link_clicks",
      "ctr",
      "cpm",
      "actions",
      "video_p25_watched_actions",
      "video_p50_watched_actions",
      "video_p75_watched_actions",
      "video_p100_watched_actions",
      "video_thruplay_watched_actions",
      "video_avg_time_watched_actions",
    ].join(",");
    const url = `${GRAPH}/${CONTA}/insights?level=ad&date_preset=${preset}&fields=${campos}&limit=200&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const j = (await r.json()) as { data?: Record<string, unknown>[]; error?: { message: string } };
    if (!r.ok || !j.data) {
      erros.push(j.error?.message ?? String(r.status));
      continue;
    }
    const st = await fetch(
      `${GRAPH}/${CONTA}/ads?fields=name,effective_status,created_time&limit=200&access_token=${encodeURIComponent(token)}`
    ).then((x) => x.json() as Promise<{ data?: { id: string; effective_status: string; created_time: string }[] }>);
    const status = new Map((st.data ?? []).map((a) => [a.id, a]));

    const anuncios = j.data.map((a) => {
      const acoes = a.actions as Acao[] | undefined;
      const impressoes = Number(a.impressions ?? 0);
      const gasto = Number(a.spend ?? 0);
      const leads = soma(acoes, "lead") || soma(acoes, "onsite_conversion.lead_grouped");
      const v3s = soma(acoes, "video_view");
      const v = (k: string) => soma(a[k] as Acao[] | undefined, "video_view");
      const s = status.get(a.ad_id as string);
      return {
        anuncio: a.ad_name,
        conjunto: a.adset_name,
        campanha: a.campaign_name,
        status: s?.effective_status ?? null,
        criado: s?.created_time?.slice(0, 10) ?? null,
        gasto,
        impressoes,
        cpm: Number(a.cpm ?? 0),
        ctr_link: impressoes ? +((Number(a.inline_link_clicks ?? 0) / impressoes) * 100).toFixed(2) : 0,
        leads,
        cpl: leads ? +(gasto / leads).toFixed(2) : null,
        // Gancho: % de quem viu 3s; retencao: % de quem chegou em 25/50/75/100%.
        gancho_3s: impressoes ? +((v3s / impressoes) * 100).toFixed(1) : 0,
        retencao: v3s
          ? {
              p25: +((v("video_p25_watched_actions") / v3s) * 100).toFixed(1),
              p50: +((v("video_p50_watched_actions") / v3s) * 100).toFixed(1),
              p75: +((v("video_p75_watched_actions") / v3s) * 100).toFixed(1),
              p100: +((v("video_p100_watched_actions") / v3s) * 100).toFixed(1),
            }
          : null,
        tempo_medio_s: v("video_avg_time_watched_actions"),
      };
    });
    return NextResponse.json({ preset, anuncios });
  }
  return NextResponse.json({ error: "nenhum token leu a conta de anuncios", erros }, { status: 502 });
}
