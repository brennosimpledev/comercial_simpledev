"use server";

// Numeros de marketing da tela de Leads: o que a Meta cobrou (gasto, CPM,
// CPC, leads) cruzado com o que aconteceu com cada lead no CRM
// (qualificado, desqualificado, reuniao, fechamento), no total e por
// anuncio. So leitura.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anunciosNoPeriodo, metaPorDia } from "@/lib/meta/insights";

export type Funil = {
  gasto: number;
  impressoes: number;
  cliques: number;
  leads_meta: number;
  pessoas: number;
  // Responderam depois da nossa primeira mensagem (formulario nao conta).
  conversaram: number;
  qualificados: number;
  desqualificados: number;
  reunioes: number;
  realizadas: number;
  fechados: number;
  valor_fechado: number;
};

export type LinhaAnuncio = Funil & { anuncio: string; campanha: string };

export type Marketing = {
  total: Funil;
  // Um ponto por dia do periodo ("AAAA-MM-DD"): lead conta no dia em que
  // entrou (coorte), gasto/impressoes/cliques no dia em que a Meta cobrou.
  serie: { dia: string; f: Funil }[];
  anuncios: LinhaAnuncio[];
  sem_anuncio: number;
  // Leads do periodo que nao vieram da Meta (organico, indicacao...).
  outras_origens: number;
  erro?: string;
};

const vazio = (): Funil => ({
  gasto: 0,
  impressoes: 0,
  cliques: 0,
  leads_meta: 0,
  pessoas: 0,
  conversaram: 0,
  qualificados: 0,
  desqualificados: 0,
  reunioes: 0,
  realizadas: 0,
  fechados: 0,
  valor_fechado: 0,
});

const ultimos8 = (w: string | null) => (w ?? "").replace(/\D/g, "").slice(-8);

export async function metricasMarketing(de: string, ate: string): Promise<Marketing | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login de novo." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { error: "Período inválido." };

  // Dia de Brasilia: 00h = 03h UTC.
  const inicio = new Date(`${de}T03:00:00Z`).toISOString();
  const fim = new Date(new Date(`${ate}T03:00:00Z`).getTime() + 86_400_000).toISOString();

  const admin = createAdminClient();
  const [meta, metaDias, { data: leads }] = await Promise.all([
    anunciosNoPeriodo(de, ate),
    metaPorDia(de, ate),
    admin
      .from("leads")
      .select("id, created_at, whatsapp, origem, utm_content, utm_campaign, meta_ad_id, qualificado, desqualificado, estagio, valor_fechado, ja_cliente")
      .gte("created_at", inicio)
      .lt("created_at", fim)
      .eq("ja_cliente", false),
  ]);

  const lista = (leads ?? []) as {
    id: string;
    created_at: string;
    whatsapp: string | null;
    origem: string | null;
    utm_content: string | null;
    utm_campaign: string | null;
    meta_ad_id: string | null;
    qualificado: boolean;
    desqualificado: boolean;
    estagio: string;
    valor_fechado: number | null;
  }[];

  const ids = lista.map((l) => l.id);
  const { data: reunioes } = ids.length
    ? await admin.from("meetings").select("lead_id, status").in("lead_id", ids)
    : { data: [] as { lead_id: string; status: string }[] };
  // Quem respondeu depois da nossa primeira mensagem. Pagina de 1000 em
  // 1000 (limite do Supabase).
  const msgs: { lead_id: string; direction: string; created_at: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    for (let de = 0; ; de += 1000) {
      const { data } = await admin
        .from("lead_messages")
        .select("lead_id, direction, created_at")
        .in("lead_id", lote)
        .order("created_at", { ascending: true })
        .range(de, de + 999);
      msgs.push(...((data ?? []) as typeof msgs));
      if (!data || data.length < 1000) break;
    }
  }
  const primeiraNossa = new Map<string, string>();
  for (const m of msgs) if (m.direction === "outbound" && !primeiraNossa.has(m.lead_id)) primeiraNossa.set(m.lead_id, m.created_at);
  const respondeu = new Set(
    msgs
      .filter((m) => m.direction === "inbound" && primeiraNossa.has(m.lead_id) && m.created_at > primeiraNossa.get(m.lead_id)!)
      .map((m) => m.lead_id)
  );

  const reuniaoDe = new Map<string, Set<string>>();
  for (const r of reunioes ?? []) {
    const s = reuniaoDe.get(r.lead_id as string) ?? new Set<string>();
    s.add(r.status as string);
    reuniaoDe.set(r.lead_id as string, s);
  }

  // Nome do anuncio pelo id (lead de Click-to-WhatsApp so traz o id).
  const nomePorId = new Map(meta.anuncios.map((a) => [a.ad_id, a.anuncio]));
  const campanhaPorNome = new Map(meta.anuncios.map((a) => [a.anuncio, a.campanha]));

  // A mesma pessoa costuma ter dois cards (formulario e conversa): junta
  // pelo telefone e conta uma vez, com o melhor resultado dos dois.
  const pessoas = new Map<string, typeof lista>();
  for (const l of lista) {
    const chave = ultimos8(l.whatsapp) || l.id;
    pessoas.set(chave, [...(pessoas.get(chave) ?? []), l]);
  }

  const total = vazio();
  // Dia de Brasilia de cada lead e um Funil por dia do periodo.
  const diaBR = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const porDia = new Map<string, Funil>();
  for (let d = new Date(`${de}T00:00:00Z`); d <= new Date(`${ate}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    porDia.set(d.toISOString().slice(0, 10), vazio());
  }
  const porAnuncio = new Map<string, Funil>();
  let semAnuncio = 0;
  let outrasOrigens = 0;

  for (const cards of pessoas.values()) {
    const anuncio =
      cards.map((c) => c.utm_content).find(Boolean) ??
      cards.map((c) => (c.meta_ad_id ? nomePorId.get(c.meta_ad_id) ?? null : null)).find(Boolean) ??
      null;
    const daMeta = Boolean(anuncio) || cards.some((c) => c.origem === "meta_ads");
    if (!daMeta) {
      outrasOrigens++;
      continue;
    }

    const statusReuniao = new Set(cards.flatMap((c) => [...(reuniaoDe.get(c.id) ?? [])]));
    const r = {
      conversou: cards.some((c) => respondeu.has(c.id)),
      qualificado: cards.some((c) => c.qualificado),
      desqualificado: cards.some((c) => c.desqualificado),
      reuniao: [...statusReuniao].some((s) => s !== "cancelada"),
      realizada: statusReuniao.has("realizada"),
      fechado: cards.some((c) => c.estagio === "fechado" || Number(c.valor_fechado ?? 0) > 0),
      valor: Math.max(0, ...cards.map((c) => Number(c.valor_fechado ?? 0))),
    };

    const somar = (f: Funil) => {
      f.pessoas++;
      if (r.conversou) f.conversaram++;
      if (r.qualificado) f.qualificados++;
      if (r.desqualificado) f.desqualificados++;
      if (r.reuniao) f.reunioes++;
      if (r.realizada) f.realizadas++;
      if (r.fechado) {
        f.fechados++;
        f.valor_fechado += r.valor;
      }
    };
    somar(total);
    const dia = porDia.get(diaBR(cards.map((c) => c.created_at).sort()[0]));
    if (dia) somar(dia);
    if (anuncio) {
      if (!porAnuncio.has(anuncio)) porAnuncio.set(anuncio, vazio());
      somar(porAnuncio.get(anuncio)!);
    } else {
      semAnuncio++;
    }
  }

  // Gasto e entrega vem da Meta, somado por nome de anuncio (o mesmo
  // anuncio pode estar em mais de um conjunto).
  for (const a of meta.anuncios) {
    total.gasto += a.gasto;
    total.impressoes += a.impressoes;
    total.cliques += a.cliques_link;
    total.leads_meta += a.leads_meta;
    if (!porAnuncio.has(a.anuncio)) porAnuncio.set(a.anuncio, vazio());
    const f = porAnuncio.get(a.anuncio)!;
    f.gasto += a.gasto;
    f.impressoes += a.impressoes;
    f.cliques += a.cliques_link;
    f.leads_meta += a.leads_meta;
  }

  for (const [dia, m] of metaDias) {
    const f = porDia.get(dia);
    if (!f) continue;
    f.gasto += m.gasto;
    f.impressoes += m.impressoes;
    f.cliques += m.cliques_link;
    f.leads_meta += m.leads_meta;
  }

  const anuncios: LinhaAnuncio[] = [...porAnuncio.entries()]
    .map(([anuncio, f]) => ({ anuncio, campanha: campanhaPorNome.get(anuncio) ?? "", ...f }))
    .filter((a) => a.gasto > 0 || a.pessoas > 0)
    .sort((a, b) => b.gasto - a.gasto || b.pessoas - a.pessoas);

  return {
    total,
    serie: [...porDia.entries()].map(([dia, f]) => ({ dia, f })),
    anuncios,
    sem_anuncio: semAnuncio,
    outras_origens: outrasOrigens,
    ...(meta.erro ? { erro: meta.erro } : {}),
  };
}
