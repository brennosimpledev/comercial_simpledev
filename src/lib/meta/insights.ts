// Numeros dos anuncios na Meta (gasto, impressoes, cliques, leads) por
// anuncio, num periodo. SERVER-ONLY. Le com META_ADS_ACCESS_TOKEN (usuario
// do sistema com ads_read); o token de eventos do CRM nao le anuncios.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

// As contas da SimpleDev. META_AD_ACCOUNT_IDS (separadas por virgula)
// substitui a lista; sem ela, le todas as que o token enxerga.
async function contas(token: string): Promise<string[]> {
  const fixas = (process.env.META_AD_ACCOUNT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fixas.length) return fixas;
  const r = await fetch(`${GRAPH}/me/adaccounts?fields=id&limit=50&access_token=${encodeURIComponent(token)}`, {
    next: { revalidate: 3600 },
  });
  const j = (await r.json()) as { data?: { id: string }[] };
  return (j.data ?? []).map((c) => c.id);
}

type Acao = { action_type: string; value: string };
const acao = (lista: Acao[] | undefined, tipo: string) =>
  Number((lista ?? []).find((a) => a.action_type === tipo)?.value ?? 0);

export type AnuncioMeta = {
  ad_id: string;
  anuncio: string;
  conjunto: string;
  campanha: string;
  gasto: number;
  impressoes: number;
  cliques_link: number;
  leads_meta: number;
};

export async function anunciosNoPeriodo(
  de: string,
  ate: string
): Promise<{ anuncios: AnuncioMeta[]; erro?: string }> {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  if (!token) return { anuncios: [], erro: "Falta META_ADS_ACCESS_TOKEN na Vercel." };

  const campos = "ad_id,ad_name,adset_name,campaign_name,spend,impressions,inline_link_clicks,actions";
  const periodo = encodeURIComponent(JSON.stringify({ since: de, until: ate }));
  const lista: AnuncioMeta[] = [];
  const erros: string[] = [];

  for (const conta of await contas(token)) {
    let url: string | null =
      `${GRAPH}/${conta}/insights?level=ad&time_range=${periodo}&fields=${campos}&limit=500&access_token=${encodeURIComponent(token)}`;
    while (url) {
      const r = await fetch(url, { next: { revalidate: 900 } });
      const j = (await r.json()) as {
        data?: Record<string, unknown>[];
        paging?: { next?: string };
        error?: { message: string };
      };
      if (!r.ok || !j.data) {
        erros.push(j.error?.message ?? String(r.status));
        break;
      }
      for (const a of j.data) {
        const acoes = a.actions as Acao[] | undefined;
        lista.push({
          ad_id: String(a.ad_id),
          anuncio: String(a.ad_name ?? ""),
          conjunto: String(a.adset_name ?? ""),
          campanha: String(a.campaign_name ?? ""),
          gasto: Number(a.spend ?? 0),
          impressoes: Number(a.impressions ?? 0),
          cliques_link: Number(a.inline_link_clicks ?? 0),
          // Formulario instantaneo conta "lead"; o agrupado cobre o resto.
          leads_meta: acao(acoes, "lead") || acao(acoes, "onsite_conversion.lead_grouped"),
        });
      }
      url = j.paging?.next ?? null;
    }
  }
  return { anuncios: lista, ...(erros.length && !lista.length ? { erro: erros[0] } : {}) };
}

export type DiaMeta = { gasto: number; impressoes: number; cliques_link: number; leads_meta: number };

// Mesmos numeros, somados por dia (todas as contas), para o grafico do
// funil. Chave: "AAAA-MM-DD" no fuso da conta.
export async function metaPorDia(de: string, ate: string): Promise<Map<string, DiaMeta>> {
  const dias = new Map<string, DiaMeta>();
  const token = process.env.META_ADS_ACCESS_TOKEN;
  if (!token) return dias;
  const campos = "spend,impressions,inline_link_clicks,actions";
  const periodo = encodeURIComponent(JSON.stringify({ since: de, until: ate }));
  for (const conta of await contas(token)) {
    let url: string | null =
      `${GRAPH}/${conta}/insights?level=account&time_increment=1&time_range=${periodo}&fields=${campos}&limit=500&access_token=${encodeURIComponent(token)}`;
    while (url) {
      const r = await fetch(url, { next: { revalidate: 900 } });
      const j = (await r.json()) as { data?: Record<string, unknown>[]; paging?: { next?: string } };
      if (!r.ok || !j.data) break;
      for (const d of j.data) {
        const dia = String(d.date_start);
        const acoes = d.actions as Acao[] | undefined;
        const atual = dias.get(dia) ?? { gasto: 0, impressoes: 0, cliques_link: 0, leads_meta: 0 };
        atual.gasto += Number(d.spend ?? 0);
        atual.impressoes += Number(d.impressions ?? 0);
        atual.cliques_link += Number(d.inline_link_clicks ?? 0);
        atual.leads_meta += acao(acoes, "lead") || acao(acoes, "onsite_conversion.lead_grouped");
        dias.set(dia, atual);
      }
      url = j.paging?.next ?? null;
    }
  }
  return dias;
}
