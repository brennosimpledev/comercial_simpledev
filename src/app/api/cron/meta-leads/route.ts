import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GRAPH, gravarLeadDaMeta, tokenDaPaginaReserva, type LeadDaMeta } from "@/lib/meta/leadgen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rede de seguranca dos leads da Meta. Roda a cada 30 min (vercel.json).
//
// Le os formularios instantaneos da pagina direto na Meta e grava no CRM
// qualquer lead que nao esteja la. O webhook /api/webhook/meta continua
// sendo o caminho normal (entra na hora); isto pega o lead cujo aviso nao
// chegou ou falhou. Em 24/11/2026 havia 11 formularios sem card, mas por
// exclusao na tela de leads, nao por falha do aviso (lib/leads/gemeos.ts).
//
//   GET ?secret=...&ensaio=1     lista o que traria, sem gravar
//   GET ?secret=...&horas=400    janela maior (padrao: 48 horas)
//   GET ?secret=...&ensaio=1&testar_reserva=1   prova o token de reserva

// Lead mais novo que isto pode estar sendo gravado pelo webhook agora.
const FOLGA_DO_WEBHOOK_MS = 10 * 60_000;

type LeadDoForm = LeadDaMeta & { id: string };

async function ler(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return j as { data?: unknown[]; paging?: { next?: string } };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  const auth = request.headers.get("authorization");
  if (!secret || (auth !== `Bearer ${secret}` && q.get("secret") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const pagina = process.env.META_PAGE_ID;
  // Sem o token da pagina (ou com ele recusado, mais abaixo) vale o de
  // reserva, do usuario de sistema: a rede de seguranca nao pode cair junto
  // com o aviso por causa do mesmo token.
  // ?testar_reserva=1 finge que o token principal quebrou, para provar que
  // a reserva assume (usar junto com ensaio=1).
  const principal = q.get("testar_reserva") === "1" ? "token_invalido_de_teste" : process.env.META_PAGE_ACCESS_TOKEN;
  const token = principal ?? (await tokenDaPaginaReserva());
  if (!token || !pagina) {
    return NextResponse.json({ ok: false, erro: "Falta META_PAGE_ACCESS_TOKEN ou META_PAGE_ID." });
  }
  const ensaio = q.get("ensaio") === "1";
  const horas = Math.min(Math.max(Number(q.get("horas") ?? 48) || 48, 1), 24 * 60);
  const agora = Date.now();
  const desdeUnix = Math.floor((agora - horas * 3600_000) / 1000);
  let t = encodeURIComponent(token);
  let pelaReserva = false;

  try {
    const listar = () =>
      ler(`${GRAPH}/${pagina}/leadgen_forms?fields=id,status&limit=100&access_token=${t}`).then(
        (j) => j.data as { id: string; status: string }[] | undefined
      );
    let forms: { id: string; status: string }[] | undefined;
    try {
      forms = await listar();
    } catch (e) {
      const outro = await tokenDaPaginaReserva();
      if (!outro || outro === token) throw e;
      console.error(
        `[cron/meta-leads] META_PAGE_ACCESS_TOKEN falhou (${String(e).slice(0, 200)}); usando o token de reserva. Renovar o token da pagina na Vercel.`
      );
      t = encodeURIComponent(outro);
      pelaReserva = true;
      forms = await listar();
    }

    const naMeta: LeadDoForm[] = [];
    const filtro = encodeURIComponent(
      JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desdeUnix }])
    );
    for (const f of forms ?? []) {
      let url: string | undefined =
        `${GRAPH}/${f.id}/leads?fields=id,created_time,ad_id,ad_name,adset_name,campaign_name,form_id,platform,field_data&filtering=${filtro}&limit=200&access_token=${t}`;
      for (let pag = 0; url && pag < 10; pag++) {
        const j: { data?: unknown[]; paging?: { next?: string } } = await ler(url);
        for (const l of (j.data ?? []) as LeadDoForm[]) naMeta.push({ ...l, form_id: l.form_id ?? f.id });
        url = j.paging?.next;
      }
    }

    const supabase = createAdminClient();
    const noCrm = new Set<string>();
    const ids = naMeta.map((l) => l.id);
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from("leads").select("meta_lead_id").in("meta_lead_id", ids.slice(i, i + 150));
      for (const r of data ?? []) noCrm.add(r.meta_lead_id as string);
    }

    const fora = naMeta.filter(
      (l) => !noCrm.has(l.id) && agora - new Date(l.created_time ?? 0).getTime() > FOLGA_DO_WEBHOOK_MS
    );
    if (ensaio) {
      return NextResponse.json({
        ensaio: true,
        ...(pelaReserva ? { token_de_reserva: true } : {}),
        horas,
        na_meta: naMeta.length,
        ja_no_crm: noCrm.size,
        traria: fora.map((l) => ({ leadgen_id: l.id, criado_na_meta: l.created_time, anuncio: l.ad_name ?? null })),
      });
    }

    const resultado = [];
    for (const l of fora) {
      const r = await gravarLeadDaMeta(
        supabase,
        l.id,
        l,
        { leadgen_id: l.id, form_id: l.form_id, ad_id: l.ad_id, page_id: pagina, created_time: l.created_time, origem: "conferencia" },
        { recuperado: true }
      );
      resultado.push({ leadgen_id: l.id, criado_na_meta: l.created_time, ...(r.ok ? { acao: r.acao, lead: r.id } : { erro: r.erro }) });
    }
    const criados = resultado.filter((r) => "acao" in r && r.acao === "criado").length;
    if (criados > 0) console.error(`[cron/meta-leads] ${criados} lead(s) da Meta nao tinham entrado pelo webhook e foram recuperados`);
    return NextResponse.json({
      ok: true,
      ...(pelaReserva ? { token_de_reserva: true } : {}),
      horas,
      na_meta: naMeta.length,
      ja_no_crm: noCrm.size,
      criados,
      resultado,
    });
  } catch (e) {
    console.error("[cron/meta-leads]", e);
    return NextResponse.json({ ok: false, erro: String(e).slice(0, 500) }, { status: 500 });
  }
}
