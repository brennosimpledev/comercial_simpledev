import { mapFields } from "@/lib/meta/leadgen";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brCanonical, last8 } from "@/lib/phone";
import { consultarNumeros, fetchWhatsAppHistory, toWaNumber, variantesBR } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Conferencia lead a lead: tudo que a Meta guardou dos formularios
// instantaneos da pagina x o que existe no CRM. Somente leitura.
//
// O relatorio da conta de anuncios so da o total por dia, e total nao
// separa "a mesma pessoa preencheu duas vezes" (o CRM junta pelo telefone)
// de "o aviso da Meta nunca chegou" (lead perdido). Aqui cada leadgen_id e
// procurado no CRM, primeiro pelo id e depois pelo telefone.
//
//   GET ?secret=...&desde=2026-10-01
//
// Tambem devolve a configuracao de cada formulario (perguntas e se e do
// tipo "maior intencao"), que pesa na qualidade do lead.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

type Campo = { name: string; values: string[] };
type LeadMeta = { id: string; created_time: string; ad_id?: string; ad_name?: string; field_data?: Campo[] };

async function ler(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return j as { data?: unknown[]; paging?: { next?: string } } & Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // ?conferir=id1,id2: para leads que estao no CRM sem nenhuma mensagem,
  // diz se o numero tem WhatsApp e quantas mensagens o servidor do WhatsApp
  // guarda com ele (nossas e dele). Separa "numero invalido" de "ninguem
  // chamou" e de "chamaram pelo celular e o CRM nao registrou". So leitura.
  const conferir = q.get("conferir");
  if (conferir) {
    const supabase = createAdminClient();
    const { data } = await supabase.from("leads").select("id, whatsapp").in("id", conferir.split(",").slice(0, 30));
    const saida = [];
    for (const l of data ?? []) {
      const tel = String(l.whatsapp ?? "").replace(/[^0-9]/g, "");
      const consulta = tel.length >= 10 ? await consultarNumeros(variantesBR(tel)) : null;
      const achado = consulta?.find((n) => n.exists);
      const numero = achado ? (achado.number ?? achado.jid?.split("@")[0] ?? tel) : tel;
      const hist = tel.length >= 10 ? await fetchWhatsAppHistory(toWaNumber(numero)) : [];
      saida.push({
        id: l.id,
        digitos: tel.length,
        numero_tem_whatsapp: consulta ? consulta.some((n) => n.exists) : null,
        mensagens_no_whatsapp: hist.length,
        nossas: hist.filter((m) => m.key?.fromMe).length,
      });
    }
    return NextResponse.json({ conferir: saida });
  }
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pagina = process.env.META_PAGE_ID;
  if (!token || !pagina) return NextResponse.json({ erro: "Falta META_PAGE_ACCESS_TOKEN ou META_PAGE_ID." });

  const desde = q.get("desde") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const desdeUnix = Math.floor(new Date(`${desde}T03:00:00Z`).getTime() / 1000);
  const t = encodeURIComponent(token);

  try {
    const forms = await ler(
      `${GRAPH}/${pagina}/leadgen_forms?fields=id,name,status,leads_count,is_optimized_for_quality,questions{key,label,type}&limit=50&access_token=${t}`
    );
    const formularios = (forms.data ?? []) as {
      id: string;
      name: string;
      status: string;
      leads_count?: number;
      is_optimized_for_quality?: boolean;
      questions?: { key: string; label: string; type: string }[];
    }[];

    // Assinatura do app na pagina: sem "leadgen" aqui o aviso nao chega.
    let assinaturas: unknown = null;
    try {
      assinaturas = (await ler(`${GRAPH}/${pagina}/subscribed_apps?fields=name,subscribed_fields&access_token=${t}`)).data;
    } catch (e) {
      assinaturas = { erro: String(e).slice(0, 200) };
    }

    const naMeta: (LeadMeta & { form: string })[] = [];
    for (const f of formularios) {
      const filtro = encodeURIComponent(
        JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desdeUnix }])
      );
      let url: string | undefined =
        `${GRAPH}/${f.id}/leads?fields=id,created_time,ad_id,ad_name,field_data&filtering=${filtro}&limit=200&access_token=${t}`;
      for (let pag = 0; url && pag < 15; pag++) {
        const j: { data?: unknown[]; paging?: { next?: string } } = await ler(url);
        for (const l of (j.data ?? []) as LeadMeta[]) naMeta.push({ ...l, form: f.id });
        url = j.paging?.next;
      }
    }

    const supabase = createAdminClient();
    const ids = naMeta.map((l) => l.id);
    const noCrm = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from("leads").select("id, meta_lead_id").in("meta_lead_id", ids.slice(i, i + 150));
      for (const r of data ?? []) noCrm.set(r.meta_lead_id as string, r.id as string);
    }

    const faltando = [];
    const mesmaPessoa = [];
    for (const l of naMeta) {
      if (noCrm.has(l.id)) continue;
      const campos = mapFields(l.field_data ?? []);
      const tel = (campos.phone_number || campos.phone || "").replace(/[^0-9]/g, "");
      let existente: { id: string; created_at: string; meta_lead_id: string | null } | undefined;
      if (tel.length >= 8) {
        const { data: cand } = await supabase
          .from("leads")
          .select("id, whatsapp, created_at, meta_lead_id")
          .like("whatsapp_digits", `%${last8(tel)}`)
          .limit(10);
        existente = (cand ?? []).find((c) => brCanonical(c.whatsapp as string | null) === brCanonical(tel)) as typeof existente;
      }
      const linha = {
        leadgen_id: l.id,
        criado_na_meta: l.created_time,
        anuncio: l.ad_name ?? null,
        nome: campos.full_name || campos.name || null,
        telefone_final: tel.slice(-4),
      };
      if (existente) {
        mesmaPessoa.push({ ...linha, lead_no_crm: existente.id, entrou_no_crm: existente.created_at, id_gravado_la: existente.meta_lead_id });
      } else {
        // O servidor do WhatsApp guarda a conversa mesmo se o lead for
        // apagado do CRM. Conversa nossa com o numero = o lead existiu e foi
        // excluido; nenhuma = o aviso da Meta nunca virou lead.
        let whatsapp: { mensagens: number; nossas: number; primeira: string | null; numero_existe?: boolean | null } | null = null;
        if (tel.length >= 10) {
          // Numero sem WhatsApp tambem daria "nenhuma conversa" (o bot nao
          // escreve para ele), entao confere se o numero existe.
          const existe = await consultarNumeros(variantesBR(tel));
          const hist = await fetchWhatsAppHistory(toWaNumber(tel));
          const tempos = hist.map((m) => Number(m.messageTimestamp ?? 0)).filter(Boolean).sort((a, b) => a - b);
          whatsapp = {
            mensagens: hist.length,
            nossas: hist.filter((m) => m.key?.fromMe).length,
            primeira: tempos.length ? new Date(tempos[0] * 1000).toISOString() : null,
            numero_existe: existe ? existe.some((n) => n.exists) : null,
          };
        }
        faltando.push({ ...linha, whatsapp, email: campos.email || campos.work_email || null, telefone: tel, campos });
      }
    }

    // Calibragem do teste do WhatsApp: os mesmos dois testes em leads de
    // formulario que ESTAO no CRM. Se aqui tambem der zero conversa, o teste
    // nao prova nada.
    let calibragem: unknown = null;
    if (q.get("calibrar") === "1") {
      const { data: amostra } = await supabase
        .from("leads")
        .select("whatsapp, created_at")
        .not("meta_lead_id", "is", null)
        .gte("created_at", `${desde}T03:00:00Z`)
        .order("created_at", { ascending: false })
        .limit(12);
      const linhas = [];
      for (const a of amostra ?? []) {
        const tel = String(a.whatsapp ?? "").replace(/[^0-9]/g, "");
        if (tel.length < 10) continue;
        const hist = await fetchWhatsAppHistory(toWaNumber(tel));
        const existe = await consultarNumeros(variantesBR(tel));
        linhas.push({
          entrou: a.created_at,
          mensagens: hist.length,
          nossas: hist.filter((m) => m.key?.fromMe).length,
          numero_existe: existe ? existe.some((n) => n.exists) : null,
        });
      }
      calibragem = linhas;
    }

    return NextResponse.json({
      desde,
      calibragem,
      assinaturas_do_app_na_pagina: assinaturas,
      formularios: formularios.map((f) => ({
        id: f.id,
        nome: f.name,
        status: f.status,
        leads_total: f.leads_count ?? null,
        maior_intencao: f.is_optimized_for_quality ?? null,
        perguntas: (f.questions ?? []).map((p) => `${p.type}: ${p.label ?? p.key}`),
      })),
      leads_na_meta: naMeta.length,
      no_crm_pelo_id: naMeta.filter((l) => noCrm.has(l.id)).length,
      mesma_pessoa_outro_envio: mesmaPessoa,
      FALTANDO_NO_CRM: faltando,
    });
  } catch (e) {
    return NextResponse.json({ erro: String(e).slice(0, 500) });
  }
}
