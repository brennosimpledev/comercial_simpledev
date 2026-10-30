import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brCanonical } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Qualidade dos leads da Meta por plataforma (Facebook x Instagram) —
// somente leitura.
//
//   GET ?secret=...&dias=60
//
// A plataforma vem de onde der: o formulario grava "fb"/"ig"; o clique para
// WhatsApp traz o app de origem; lead repassado pelo WhatsApp com o id do
// formulario e consultado na Graph API. O mesmo telefone conta uma vez so.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

type Plataforma = "facebook" | "instagram" | "desconhecida";

function normalizar(v: string | null | undefined): Plataforma | null {
  const s = (v ?? "").toLowerCase();
  if (s === "fb" || s.includes("facebook")) return "facebook";
  if (s === "ig" || s.includes("instagram")) return "instagram";
  return null;
}

const ORDEM = ["nenhum", "desqualificado", "qualificado", "reuniao_marcada", "reuniao_realizada", "fechado"];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 60);
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const { data: leads, error } = await admin
    .from("leads")
    .select(
      "id, nome, whatsapp, created_at, estagio, status, qualificado, desqualificado, valor_fechado, referral_source, utm_source, meta_lead_id, raw_payload"
    )
    .eq("origem", "meta_ads")
    .eq("ja_cliente", false)
    .gte("created_at", inicio)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (leads ?? []).map((l) => l.id as string);
  const reunioes = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("meetings").select("lead_id, status").in("lead_id", ids.slice(i, i + 100));
    for (const m of data ?? []) {
      const l = reunioes.get(m.lead_id as string) ?? [];
      l.push(m.status as string);
      reunioes.set(m.lead_id as string, l);
    }
  }

  // Leads sem plataforma gravada mas com o id do formulario: pergunta a Graph.
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const daGraph = new Map<string, Plataforma>();
  const consultar = (leads ?? [])
    .filter((l) => !normalizar(l.referral_source) && !normalizar(l.utm_source) && l.meta_lead_id)
    .slice(0, 80);
  if (token) {
    await Promise.all(
      consultar.map(async (l) => {
        try {
          const r = await fetch(`${GRAPH}/${l.meta_lead_id}?fields=platform&access_token=${encodeURIComponent(token)}`);
          const j = (await r.json()) as { platform?: string };
          const p = normalizar(j.platform);
          if (p) daGraph.set(l.id as string, p);
        } catch {
          /* fica desconhecida */
        }
      })
    );
  }

  type Item = {
    nome: string;
    criado: string;
    plataforma: Plataforma;
    nivel: string;
    estagio: string;
    campanha: string | null;
    anuncio: string | null;
    valor: number | null;
  };
  const porTelefone = new Map<string, Item>();

  for (const l of leads ?? []) {
    const plataforma =
      normalizar(l.referral_source) ?? normalizar(l.utm_source) ?? daGraph.get(l.id as string) ?? "desconhecida";
    const ms = reunioes.get(l.id as string) ?? [];
    const nivel =
      l.estagio === "fechado" || l.status === "ganho"
        ? "fechado"
        : ms.includes("realizada") || ["reuniao_feita", "escopo_enviado", "apresentacao_marcada", "negociacao", "proposta", "interesse"].includes(l.estagio as string)
          ? "reuniao_realizada"
          : ms.length > 0 || l.estagio === "reuniao_marcada"
            ? "reuniao_marcada"
            : l.desqualificado
              ? "desqualificado"
              : l.qualificado
                ? "qualificado"
                : "nenhum";
    const meta = ((l.raw_payload as { lead?: { campaign_name?: string; ad_name?: string } } | null)?.lead) ?? {};
    const item: Item = {
      nome: l.nome as string,
      criado: (l.created_at as string).slice(0, 10),
      plataforma,
      nivel,
      estagio: l.estagio as string,
      campanha: meta.campaign_name ?? null,
      anuncio: meta.ad_name ?? null,
      valor: (l.valor_fechado as number | null) ?? null,
    };

    // Formulario e WhatsApp do mesmo telefone sao a mesma pessoa.
    const chave = brCanonical(l.whatsapp as string | null) ?? `id:${l.id}`;
    const ja = porTelefone.get(chave);
    if (!ja) {
      porTelefone.set(chave, item);
      continue;
    }
    porTelefone.set(chave, {
      ...ja,
      plataforma: ja.plataforma !== "desconhecida" ? ja.plataforma : item.plataforma,
      nivel: ORDEM.indexOf(item.nivel) > ORDEM.indexOf(ja.nivel) ? item.nivel : ja.nivel,
      estagio: ORDEM.indexOf(item.nivel) > ORDEM.indexOf(ja.nivel) ? item.estagio : ja.estagio,
      campanha: ja.campanha ?? item.campanha,
      anuncio: ja.anuncio ?? item.anuncio,
      valor: ja.valor ?? item.valor,
    });
  }

  const pessoas = [...porTelefone.values()];
  const resumo: Record<string, Record<string, number>> = {};
  for (const p of pessoas) {
    const r = (resumo[p.plataforma] ??= { pessoas: 0, nenhum: 0, desqualificado: 0, qualificado: 0, reuniao_marcada: 0, reuniao_realizada: 0, fechado: 0 });
    r.pessoas++;
    r[p.nivel]++;
  }

  return NextResponse.json({
    dias,
    consultados_na_graph: consultar.length,
    resumo,
    // Do Facebook, quem passou de "nenhum": qualificado, reuniao ou fechado.
    facebook_bons: pessoas.filter(
      (p) => p.plataforma === "facebook" && ORDEM.indexOf(p.nivel) >= ORDEM.indexOf("qualificado")
    ),
    facebook_desqualificados: pessoas.filter((p) => p.plataforma === "facebook" && p.nivel === "desqualificado").length,
  });
}
