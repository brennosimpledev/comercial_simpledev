import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailDoFormulario } from "@/lib/bot/formulario";
import { cardDaConversaPeloEmail, cardDoFormularioPeloTexto, passarFormulario } from "@/lib/leads/gemeos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cards duplicados de formulario: a pessoa preencheu com um numero e
// conversa por outro (lib/leads/gemeos.ts). Lista os pares e, a pedido,
// junta: o formulario vai para o card da conversa e o card parado sai.
//
//   GET ?secret=...&desde=2026-10-01&ate=2026-10-20   so lista (padrao)
//   GET ?secret=...&juntar=recuperados    junta os que a conferencia com a
//                                         Meta recriou (nota "Lead recuperado")
//   GET ?secret=...&juntar=parados        junta todo par cujo card do
//                                         formulario nunca foi trabalhado
//   GET ?secret=...&provar=1              confere se a regra nova do WhatsApp
//                                         teria achado o card do formulario
//                                         na primeira mensagem de cada par
//
// "Nunca foi trabalhado" = etapa novo, sem conversa, sem reuniao, sem marca
// de qualificado/desqualificado e sem anotacao de gente. Par em que o card
// do formulario foi trabalhado fica na lista como "revisar" e nao e tocado.

type Form = {
  id: string;
  nome: string | null;
  email: string | null;
  necessidade: string | null;
  created_at: string;
  estagio: string;
  qualificado: boolean | null;
  desqualificado: boolean | null;
  anotacoes: string | null;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const desde = q.get("desde") ?? "2026-10-01";
  // A busca e uma por formulario; periodos longos estouram o tempo da rota.
  const ate = q.get("ate") ?? "2100-01-01";
  const juntar = q.get("juntar");
  const provar = q.get("provar") === "1";
  const supabase = createAdminClient();

  const forms: Form[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await supabase
      .from("leads")
      .select("id, nome, email, necessidade, created_at, estagio, qualificado, desqualificado, anotacoes")
      .not("meta_lead_id", "is", null)
      .eq("ja_cliente", false)
      .gte("created_at", `${desde}T03:00:00Z`)
      .lt("created_at", `${ate}T03:00:00Z`)
      .order("created_at", { ascending: true })
      .range(i, i + 999);
    forms.push(...((data ?? []) as Form[]));
    if ((data ?? []).length < 1000) break;
  }

  const pares = [];
  for (const f of forms) {
    const email = emailDoFormulario(f.necessidade, f.email);
    if (!email) continue;
    const conversa = await cardDaConversaPeloEmail(supabase, email, new Date(f.created_at), f.id);
    if (!conversa) continue;

    const [{ count: falas }, { count: reunioes }, { data: c }] = await Promise.all([
      supabase.from("lead_messages").select("id", { count: "exact", head: true }).eq("lead_id", f.id),
      supabase.from("meetings").select("id", { count: "exact", head: true }).eq("lead_id", f.id),
      supabase.from("leads").select("nome, estagio, qualificado, desqualificado").eq("id", conversa).single(),
    ]);
    const recuperado = (f.anotacoes ?? "").includes("Lead recuperado pela conferência");
    const anotacaoDeGente = Boolean(f.anotacoes) && !recuperado;
    const parado =
      f.estagio === "novo" &&
      (falas ?? 0) === 0 &&
      (reunioes ?? 0) === 0 &&
      !f.qualificado &&
      !f.desqualificado &&
      !anotacaoDeGente;

    let prova: string | undefined;
    if (provar) {
      const { data: primeira } = await supabase
        .from("lead_messages")
        .select("body, created_at")
        .eq("lead_id", conversa)
        .eq("direction", "inbound")
        .order("created_at", { ascending: true })
        .limit(1);
      const m = primeira?.[0];
      const achou = m
        ? await cardDoFormularioPeloTexto(supabase, m.body as string | null, new Date(m.created_at as string))
        : null;
      // Card do formulario recriado hoje pela conferencia nao existia na
      // hora da mensagem; a prova so vale para os que entraram pelo aviso.
      prova = achou?.id === f.id ? "acharia" : (falas ?? 0) > 0 ? "nao (card do formulario ja tinha conversa)" : "nao";
    }

    let feito: string | undefined;
    const pedeEste = juntar === "parados" ? parado : juntar === "recuperados" ? parado && recuperado : false;
    if (pedeEste) {
      const r = await passarFormulario(supabase, f.id, conversa);
      if (!r.ok) feito = `nao juntou: ${r.erro}`;
      else {
        const { error } = await supabase.from("leads").delete().eq("id", f.id);
        feito = error ? `formulario passou, mas o card nao saiu: ${error.message}` : "juntado";
      }
    }

    pares.push({
      formulario: { id: f.id, nome: f.nome, entrou: f.created_at, etapa: f.estagio, conversa: falas ?? 0, recuperado },
      conversa: {
        id: conversa,
        nome: c?.nome ?? null,
        etapa: c?.estagio ?? null,
        qualificado: Boolean(c?.qualificado),
        desqualificado: Boolean(c?.desqualificado),
      },
      situacao: parado ? "card do formulario parado" : "revisar: card do formulario foi trabalhado",
      ...(prova ? { regra_nova: prova } : {}),
      ...(feito ? { feito } : {}),
    });
  }

  return NextResponse.json({
    desde,
    formularios: forms.length,
    pares: pares.length,
    parados: pares.filter((p) => p.situacao.startsWith("card")).length,
    revisar: pares.filter((p) => p.situacao.startsWith("revisar")).length,
    ...(juntar ? { juntados: pares.filter((p) => p.feito === "juntado").length } : {}),
    lista: pares,
  });
}
