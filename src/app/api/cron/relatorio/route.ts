import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consultarNumeros, sendWhatsAppText, variantesBR } from "@/lib/evolution/client";
import { MODELO } from "@/lib/bot/cerebro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Relatorio do atendimento automatico para o dono, pelo WhatsApp do
// comercial. Roda pelo vercel.json as 9h e 20h no feriado de Finados 2026
// (31/10 a 02/11); depois, tirar os horarios de la.
//
//   GET ?secret=...&ensaio=1     -> devolve o texto, nao envia
//   GET ?secret=...&verificar=1  -> confere o numero no WhatsApp, nao envia
//   GET (cron) / ?secret=...     -> envia
//
// Cobre as ultimas `horas` (padrao 14): bot de primeiro atendimento,
// regua de follow-up, lembretes e bot de reuniao, reunioes marcadas e
// clientes esperando resposta.

// Numero pessoal do Brenno, passado por ele em 30/10 para receber o relatorio.
const PARA = process.env.RELATORIO_WHATSAPP ?? "6292139866";

type Msg = {
  lead_id: string;
  direction: string;
  created_at: string;
  body: string | null;
  raw: Record<string, unknown> | null;
};

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function tipo(m: Msg) {
  const r = (m.raw ?? {}) as { followup?: string; lembrete?: string; reuniao?: string; bot?: boolean; acao?: string; agendou?: string };
  if (m.direction === "inbound") return "cliente";
  if (r.followup) return "followup";
  if (r.lembrete) return `lembrete:${r.lembrete}`;
  if (r.reuniao) return `reuniao:${r.acao ?? ""}`;
  if (r.bot) return r.agendou ? "bot:agendou" : "bot";
  return "time";
}

async function destino(): Promise<string | null> {
  const r = await consultarNumeros(variantesBR(PARA));
  const achado = r?.find((n) => n.exists);
  return achado ? (achado.number ?? achado.jid?.split("@")[0] ?? null) : null;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}` && q.get("secret") !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (q.get("verificar") === "1") {
    return NextResponse.json({ variantes: variantesBR(PARA), consulta: await consultarNumeros(variantesBR(PARA)) });
  }

  const horas = Number(q.get("horas") ?? 14);
  const agora = Date.now();
  const desde = new Date(agora - horas * 3600_000).toISOString();
  const admin = createAdminClient();

  // Conversas que tiveram alguma mensagem automatica na janela.
  const { data: autos } = await admin
    .from("lead_messages")
    .select("lead_id")
    .eq("direction", "outbound")
    .gte("created_at", desde)
    .or("raw->>followup.not.is.null,raw->>lembrete.not.is.null,raw->>bot.not.is.null");
  const ids = [...new Set((autos ?? []).map((a) => a.lead_id as string))];

  const { data: leads } = await admin
    .from("leads")
    .select("id, nome, estagio")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const nomeDe = new Map((leads ?? []).map((l) => [l.id as string, (l.nome as string) ?? "?"]));

  const { data: msgs } = await admin
    .from("lead_messages")
    .select("lead_id, direction, created_at, body, raw")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .gte("created_at", desde)
    .order("created_at", { ascending: true });

  const porLead = new Map<string, Msg[]>();
  for (const m of (msgs ?? []) as Msg[]) porLead.set(m.lead_id, [...(porLead.get(m.lead_id) ?? []), m]);

  const atendidos: string[] = [];
  const followups: string[] = [];
  const lembretes: string[] = [];
  const reuniaoBot: string[] = [];
  const trechos: string[] = [];
  for (const [id, lista] of porLead) {
    const nome = nomeDe.get(id) ?? "?";
    const tipos = lista.map(tipo);
    const respondeu = (i: number) => tipos.slice(i + 1).includes("cliente");
    if (tipos.some((t) => t.startsWith("bot"))) {
      const agendou = tipos.includes("bot:agendou");
      const i = tipos.indexOf("bot");
      atendidos.push(`${nome}${agendou ? " (AGENDOU)" : respondeu(i === -1 ? 0 : i) ? " (conversou)" : " (sem resposta)"}`);
    }
    tipos.forEach((t, i) => {
      if (t === "followup") followups.push(`${nome}${respondeu(i) ? " (respondeu)" : ""}`);
      if (t.startsWith("lembrete:")) lembretes.push(`${t.split(":")[1]} ${nome}${respondeu(i) ? " (respondeu)" : ""}`);
      if (t.startsWith("reuniao:")) reuniaoBot.push(`${nome}: ${t.split(":")[1] || "respondeu"}`);
    });
    trechos.push(
      `## ${nome}\n` +
        lista
          .slice(-12)
          .map((m) => `${hora(m.created_at)} ${tipo(m)}: ${(m.body ?? "").replace(/\s+/g, " ").slice(0, 160)}`)
          .join("\n")
    );
  }

  // Reunioes: as marcadas na janela e as dos proximos 4 dias.
  const { data: novas } = await admin
    .from("meetings")
    .select("lead_id, starts_at, created_by, status, leads(nome)")
    .gte("created_at", desde)
    .order("starts_at", { ascending: true });
  const { data: proximas } = await admin
    .from("meetings")
    .select("starts_at, status, confirmacao, lembrete_vespera_em, leads(nome)")
    .eq("status", "agendada")
    .gte("starts_at", new Date(agora).toISOString())
    .lte("starts_at", new Date(agora + 96 * 3600_000).toISOString())
    .order("starts_at", { ascending: true });
  const nomeReuniao = (r: { leads: unknown }) => (r.leads as { nome?: string } | null)?.nome ?? "?";
  const conf = (r: { confirmacao?: string | null; lembrete_vespera_em?: string | null }) =>
    r.confirmacao === "confirmada"
      ? "✅"
      : r.confirmacao === "remarcar"
        ? "⚠️ quer remarcar"
        : r.confirmacao === "cancelar"
          ? "⛔ quer cancelar"
          : r.lembrete_vespera_em
            ? "⏳ não confirmou"
            : "🕒";

  // Clientes esperando resposta ha mais de 1h (ultima mensagem e dele).
  const { data: recentes } = await admin
    .from("lead_messages")
    .select("lead_id, direction, created_at, leads(nome, estagio)")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(1000);
  const vistos = new Set<string>();
  const esperando: string[] = [];
  for (const m of recentes ?? []) {
    if (vistos.has(m.lead_id as string)) continue;
    vistos.add(m.lead_id as string);
    const estagio = (m.leads as { estagio?: string } | null)?.estagio;
    if (estagio === "perdido" || estagio === "fechado" || estagio === "desqualificado") continue;
    if (m.direction === "inbound" && agora - new Date(m.created_at as string).getTime() > 3600_000) {
      esperando.push(`${(m.leads as { nome?: string } | null)?.nome ?? "?"} (desde ${hora(m.created_at as string)})`);
    }
  }

  // Leitura curta da qualidade do atendimento, com as conversas reais.
  let avaliacao = "";
  if (process.env.ANTHROPIC_API_KEY && trechos.length) {
    try {
      const r = await new Anthropic().messages.create(
        {
          model: MODELO,
          max_tokens: 2000,
          system:
            "Você avalia, para o dono da SimpleDEV, o atendimento automático do WhatsApp comercial (bot de primeiro atendimento, follow-ups, lembretes e bot de reunião). Em português, no máximo 4 linhas curtas, sem markdown: diga se o bot se saiu bem e aponte problemas concretos (resposta errada, mensagem repetida, atropelou o vendedor, cliente sem resposta). Não invente nada que não esteja nas conversas.",
          messages: [{ role: "user", content: trechos.join("\n\n").slice(0, 30_000) }],
        },
        { timeout: 30_000 }
      );
      avaliacao = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } catch (e) {
      console.error("[relatorio] avaliacao:", e);
    }
  }

  const lista = (itens: string[], vazio = "nenhum") => (itens.length ? itens.map((i) => `• ${i}`).join("\n") : vazio);
  const texto = [
    `🤖 *Relatório do comercial* (últimas ${horas}h)`,
    "",
    `*Reuniões marcadas no período* (${(novas ?? []).length})`,
    lista((novas ?? []).map((r) => `${nomeReuniao(r)}: ${hora(r.starts_at as string)}${r.created_by ? "" : " (pelo bot)"}`), "nenhuma"),
    "",
    `*Próximas reuniões (4 dias)*`,
    lista((proximas ?? []).map((r) => `${hora(r.starts_at as string)} ${nomeReuniao(r)} ${conf(r)}`), "nenhuma"),
    "",
    `*Bot atendeu* (${atendidos.length})`,
    lista(atendidos),
    "",
    `*Follow-ups automáticos* (${followups.length})`,
    lista(followups),
    "",
    `*Lembretes de reunião* (${lembretes.length})`,
    lista(lembretes),
    ...(reuniaoBot.length ? ["", `*Bot de reunião*`, lista(reuniaoBot)] : []),
    "",
    `*Esperando resposta há mais de 1h* (${esperando.length})`,
    lista(esperando.slice(0, 10), "ninguém 👌"),
    ...(avaliacao ? ["", `*Avaliação*`, avaliacao] : []),
  ].join("\n");

  if (q.get("ensaio") === "1") return NextResponse.json({ texto });

  const numero = await destino();
  if (!numero) return NextResponse.json({ error: "número do relatório não encontrado no WhatsApp", texto }, { status: 500 });
  const envio = await sendWhatsAppText(numero, texto);
  return NextResponse.json({ enviado: envio.ok, erro: envio.error ?? null, para_final: numero.slice(-4) });
}
