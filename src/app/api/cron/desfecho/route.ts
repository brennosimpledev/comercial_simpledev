import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leadsComSituacao, proximaDaRegua } from "@/lib/followups/situacao";
import { desqualificarLead } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Desfecho de quem nao responde (regra do Brenno, 24/11/2026):
// "10 tentativas, 2 por dia. Deu 10 tentativas, e desqualificado, nao
// respondido. A gente marca como negativo e manda pra Meta."
//
//   - a partir da 3a tentativa sem resposta, o card sai de "Novo" e vai
//     para "Tentando contato" (estagio "sdr");
//   - depois da 10a, o lead e desqualificado (vai para Perdido, marcado
//     "sem resposta") e a Meta recebe o evento negativo.
//
// Tentativa = um turno (manha ou tarde, horario de Brasilia) em que alguem
// nosso escreveu depois da ultima fala do cliente: o bot, a regua
// automatica ou o time. Varias mensagens no mesmo turno contam uma vez.
// Quando o cliente responde, a contagem zera.
//
// Nao mexe em quem: falou por ultimo (a vez e nossa), tem reuniao, e
// cliente, tem "proximo contato" marcado para o futuro, ou ainda tem passo
// da regua automatica para receber.
//
// Roda as 9h30 e as 14h30 em dia util (vercel.json), depois da regua.
//   GET ?secret=...&ensaio=1   -> lista o que faria, sem gravar
//   GET ?secret=...&despedidos=1 -> so desqualifica quem recebeu a despedida
//     da regua com menos de 10 tentativas (decisao manual; a rotina normal
//     nao toca neles)
// DESFECHO_AUTO=0 no Vercel desliga.

const EM_CONTATO = 3;
const LIMITE = 10;
// A ultima tentativa ganha quase um dia para ser respondida.
const FOLGA_H = 20;
// Sem a regua (desligada ou lead antigo), o limite vale sozinho a partir daqui.
const LIMITE_SEM_REGUA = 14;
const POR_RODADA = 30;

function ligado() {
  const v = (process.env.DESFECHO_AUTO ?? "1").toLowerCase();
  return v !== "0" && v !== "off" && v !== "false";
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}` && q.get("secret") !== cronSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const ensaio = q.get("ensaio") === "1";
  if (!ensaio && !ligado()) return NextResponse.json({ ok: true, skipped: "DESFECHO_AUTO desligado" });

  const supabase = createAdminClient();
  const agora = Date.now();
  const hoje = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);

  const todos = await leadsComSituacao(supabase, 30);
  const mover: { id: string; nome: string; tentativas: number }[] = [];
  const encerrar: { id: string; nome: string; tentativas: number; ultima: string }[] = [];
  const despedidos: { id: string; nome: string; tentativas: number; ultima: string }[] = [];

  for (const { lead, s } of todos) {
    // Sem conversa, ou o cliente falou por ultimo: nao e caso de desfecho.
    if (s.ultimaDirecao !== "outbound" || !s.ultimaNossa) continue;
    if (lead.proximo_contato && lead.proximo_contato > hoje) continue;

    // So tentativa de verdade conta. `automaticos` nao serve aqui: quem
    // recebeu a despedida da regua antiga, de 4 passos, aparece la como 10.
    const tentativas = s.turnosDesdeCliente;
    const naRegua = proximaDaRegua(s) !== null && tentativas < LIMITE_SEM_REGUA;
    const paradoH = (agora - new Date(s.ultimaNossa.em).getTime()) / 3600_000;

    if (tentativas >= LIMITE && !naRegua && paradoH >= FOLGA_H) {
      encerrar.push({ id: lead.id, nome: lead.nome, tentativas, ultima: s.ultimaNossa.em });
      continue;
    }
    if (tentativas >= EM_CONTATO && lead.estagio === "novo") {
      mover.push({ id: lead.id, nome: lead.nome, tentativas });
    }
    // Regua encerrada (despedida enviada) com menos de 10 tentativas: nao
    // entra na regra; aparece no ensaio para alguem decidir.
    if (!s.respondeu && !s.falouDeVerdade && s.automaticos >= LIMITE && tentativas < LIMITE) {
      despedidos.push({ id: lead.id, nome: lead.nome, tentativas, ultima: s.ultimaNossa.em });
    }
  }

  if (ensaio) {
    return NextResponse.json({
      ensaio: true,
      ligado: ligado(),
      avaliados: todos.length,
      iria_para_tentando_contato: mover.map(({ nome, tentativas }) => ({ nome, tentativas })),
      seria_desqualificado: encerrar.map(({ nome, tentativas, ultima }) => ({ nome, tentativas, ultima })),
      despedida_enviada_com_menos_de_10: despedidos.map(({ nome, tentativas, ultima }) => ({ nome, tentativas, ultima })),
    });
  }

  const dia = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
  const encerrarLead = async (id: string, nota: string) => {
    if (!(await desqualificarLead(id))) return false;
    const { data: l } = await supabase.from("leads").select("anotacoes").eq("id", id).single();
    await supabase
      .from("leads")
      .update({ sem_resposta: true, anotacoes: [l?.anotacoes, nota].filter(Boolean).join("\n\n") })
      .eq("id", id);
    return true;
  };

  if (q.get("despedidos") === "1") {
    let feitos = 0;
    for (const d of despedidos.slice(0, POR_RODADA)) {
      const ok = await encerrarLead(
        d.id,
        `🚫 Desqualificado em ${dia} por decisão do Brenno: recebeu a despedida da régua e não respondeu (${d.tentativas} tentativas).`
      );
      if (ok) feitos++;
    }
    return NextResponse.json({ ok: true, despedidos: despedidos.length, desqualificados: feitos });
  }

  let movidos = 0;
  for (const m of mover) {
    const { error } = await supabase
      .from("leads")
      .update({ estagio: "sdr", estagio_em: new Date().toISOString() })
      .eq("id", m.id)
      .eq("estagio", "novo");
    if (!error) movidos++;
  }

  let desqualificados = 0;
  for (const e of encerrar.slice(0, POR_RODADA)) {
    const ok = await encerrarLead(e.id, `🚫 Desqualificado automaticamente em ${dia}: ${e.tentativas} tentativas sem resposta.`);
    if (ok) desqualificados++;
  }

  return NextResponse.json({
    ok: true,
    avaliados: todos.length,
    movidos_para_tentando_contato: movidos,
    desqualificados,
    ficaram_para_a_proxima: Math.max(0, encerrar.length - POR_RODADA),
  });
}
