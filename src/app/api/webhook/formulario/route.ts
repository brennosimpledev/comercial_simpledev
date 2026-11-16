import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { entrarLeadDoSite } from "@/lib/leads/entradaSite";
import { desqualificarLead } from "@/lib/conversions/report";
import type { LpWebhookPayload } from "@/lib/mappers/webhook-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Formulario com caminhos do site (lp.simpledev.com.br/formulario).
//
//   etapa "contato": a pessoa deu nome e WhatsApp. O lead ja entra no CRM
//     (lead parcial: se ela desistir depois, o time ainda chama).
//   etapa "final":   respostas completas. Grava no lead e aplica a regra:
//     sem o investimento (abaixo de R$ 20 mil, "agora nao", ou empresa que
//     fatura ate R$ 20 mil sem investimento definido) entra desqualificado,
//     e Meta/OpenAI recebem o sinal na hora.
//
// Mesmo segredo do webhook da LP (?token=).

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: CORS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type Respostas = Partial<
  Record<
    | "para_quem"
    | "o_que"
    | "descricao"
    | "segmento"
    | "faturamento"
    | "pessoas"
    | "financiamento"
    | "decisor"
    | "investimento"
    | "cabe_20k"
    | "prazo",
    string
  >
>;

const ROTULO: Record<keyof Respostas, string> = {
  para_quem: "Para quem é",
  o_que: "Quer desenvolver",
  descricao: "O que precisa fazer",
  segmento: "Segmento",
  faturamento: "Faturamento mensal",
  pessoas: "Pessoas na empresa",
  financiamento: "De onde vem o investimento",
  decisor: "Quem decide",
  investimento: "Investimento previsto",
  cabe_20k: "R$ 20 mil cabe?",
  prazo: "Quando pretende começar",
};

const ABAIXO_DO_PISO = ["Até R$ 10 mil", "R$ 10 a 20 mil"];

function avaliar(r: Respostas): "qualificado" | "desqualificado" | "longo_prazo" {
  const semValor =
    ABAIXO_DO_PISO.includes(r.investimento ?? "") ||
    r.cabe_20k === "Agora não" ||
    (r.faturamento === "Até R$ 20 mil" && (r.investimento === "Ainda não sei" || !r.investimento));
  if (semValor) return "desqualificado";
  if (r.prazo === "Mais de 3 meses") return "longo_prazo";
  return "qualificado";
}

const INICIO = "--- Formulário do site ---";
const FIM = "--- fim do formulário ---";

export async function POST(request: NextRequest) {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (secret && request.nextUrl.searchParams.get("token") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: LpWebhookPayload & { etapa?: string; respostas?: Respostas };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const r = body.respostas ?? {};
  if (!String(body.whatsapp ?? "").replace(/\D/g, "")) return json({ error: "sem whatsapp" }, 400);

  // Mesmo formato do formulario instantaneo da Meta ("pergunta: resposta |
  // ..."): o bot le daqui o que a pessoa ja respondeu e nao pergunta de novo.
  const CHAVE: Record<keyof Respostas, string> = {
    para_quem: "para_quem_e_o_projeto",
    o_que: "o_que_quer_desenvolver",
    descricao: "o_que_precisa_fazer",
    segmento: "segmento",
    faturamento: "faturamento_mensal",
    pessoas: "pessoas_na_empresa",
    financiamento: "de_onde_vem_o_investimento",
    decisor: "quem_decide",
    investimento: "investimento_previsto",
    cabe_20k: "projetos_a_partir_de_20_mil_cabem",
    prazo: "quando_pretende_comecar",
  };
  const necessidade =
    (Object.keys(CHAVE) as (keyof Respostas)[])
      .filter((k) => r[k])
      .map((k) => `${CHAVE[k]}: ${String(r[k]).replace(/[|\r\n]+/g, " ").slice(0, 300)}`)
      .join(" | ") || null;
  const entrada = await entrarLeadDoSite({
    ...body,
    necessidade: necessidade ?? undefined,
    relacao_projeto: r.para_quem,
    inicio: r.prazo,
    orcamento: r.investimento,
    Id_do_formulario: "formulario_site_v1",
  });
  if ("error" in entrada) return json({ error: entrada.error }, 500);
  const id = entrada.id;

  if (body.etapa !== "final") return json({ ok: true, id });

  const resultado = avaliar(r);

  // Respostas num bloco proprio das anotacoes (o resto o time escreve).
  const linhas = (Object.keys(ROTULO) as (keyof Respostas)[])
    .filter((k) => r[k])
    .map((k) => `${ROTULO[k]}: ${r[k]}`);
  if (r.decisor === "Outra pessoa") linhas.push("⚠️ Quem decide é outra pessoa: trazer o decisor para a reunião.");
  if (resultado === "longo_prazo") linhas.push("⏳ Longo prazo: quer começar daqui a mais de 3 meses.");
  if (resultado === "desqualificado") linhas.push("👎 Desqualificado pelo formulário (sem o investimento mínimo).");
  const bloco = `${INICIO}\n${linhas.join("\n")}\n${FIM}`;

  const admin = createAdminClient();
  const { data: atual } = await admin.from("leads").select("anotacoes").eq("id", id).single();
  const anot = (atual?.anotacoes as string | null) ?? "";
  const a = anot.indexOf(INICIO);
  const b = anot.indexOf(FIM);
  const anotacoes =
    a !== -1 && b > a ? anot.slice(0, a) + bloco + anot.slice(b + FIM.length) : anot.trim() ? `${bloco}\n\n${anot.trim()}` : bloco;

  await admin
    .from("leads")
    .update({
      anotacoes,
      ...(necessidade ? { necessidade } : {}),
      ...(r.investimento ? { orcamento: r.cabe_20k ? `${r.investimento} (R$ 20 mil: ${r.cabe_20k})` : r.investimento } : {}),
      ...(r.prazo ? { prazo: r.prazo } : {}),
      ...(r.para_quem ? { relacao_projeto: r.para_quem } : {}),
    })
    .eq("id", id);

  if (resultado === "desqualificado") await desqualificarLead(id);

  return json({ ok: true, id, resultado });
}
