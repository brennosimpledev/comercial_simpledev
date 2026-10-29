import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppText, evolutionConfigured } from "@/lib/evolution/client";
import { numeroDeCliente } from "@/lib/bot/atendente";
import { REGUA_AUTOMATICA, horarioComercial, primeiroNome } from "@/lib/followups/cadence";
import { erroLeads, leadsComSituacao, proximaDaRegua } from "@/lib/followups/situacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Regua automatica para quem nunca respondeu. Roda as 9h e as 14h em dia
// util (vercel.json) e manda, por lead, so a proxima tentativa que venceu.
//
// Desligada por padrao: so envia com FOLLOWUP_AUTO ligado no Vercel.
//   GET ?secret=...&ensaio=1            -> lista o que mandaria agora, sem enviar
//   GET ?secret=...&ensaio=1&desde=ISO  -> idem, contando leads mais antigos
//
// Guardas que vieram da queda da Evolution em set/2026: falha nao grava
// mensagem, teto por rodada e teto diario. E as da regua nova: nada fora do
// horario comercial, nada para quem respondeu, tem reuniao, e cliente ou
// esta pausado, e nada em cima de uma mensagem nossa recente.

const POR_RODADA = 25;
const TETO_DIARIO = 60;
// Se alguem do time (ou o bot) falou ha pouco, espera a proxima rodada em
// vez de empilhar mensagem.
const RESPIRO_H = 5;

function ligado() {
  const v = (process.env.FOLLOWUP_AUTO ?? "").toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

export async function GET(request: NextRequest) {
  // Vercel Cron envia Authorization: Bearer <CRON_SECRET> quando a env existe.
  const cronSecret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}` && q.get("secret") !== cronSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const ensaio = q.get("ensaio") === "1";
  if (!ensaio) {
    if (!ligado()) return NextResponse.json({ ok: true, skipped: "FOLLOWUP_AUTO desligado" });
    if (!horarioComercial()) return NextResponse.json({ ok: true, skipped: "fora do horario comercial" });
    if (!evolutionConfigured()) return NextResponse.json({ ok: true, skipped: "evolution not configured" });
  }

  const supabase = createAdminClient();
  const agora = Date.now();
  // No ensaio da para olhar leads de antes do inicio da regua.
  const desde = (ensaio && q.get("desde")) || undefined;

  const todos = await leadsComSituacao(supabase, 15);
  const candidatos = todos
    .filter(({ lead }) => !lead.bot_pausado && lead.whatsapp)
    .map(({ lead, s }) => ({ lead, s, prox: proximaDaRegua(s, desde) }))
    .filter(({ prox }) => prox && prox.vence.getTime() <= agora)
    .filter(({ s }) => !s.ultimaNossa || agora - new Date(s.ultimaNossa.em).getTime() >= RESPIRO_H * 3600_000);

  // Teto diario: conta o que a regua ja mandou hoje.
  const inicioDoDia = new Date();
  inicioDoDia.setUTCHours(3, 0, 0, 0);
  if (inicioDoDia.getTime() > agora) inicioDoDia.setUTCDate(inicioDoDia.getUTCDate() - 1);
  const { count: enviadosHoje } = await supabase
    .from("lead_messages")
    .select("id", { count: "exact", head: true })
    .not("raw->>followup", "is", null)
    .gte("created_at", inicioDoDia.toISOString());
  const limite = Math.max(0, Math.min(POR_RODADA, TETO_DIARIO - (enviadosHoje ?? 0)));

  const plano = [];
  for (const c of candidatos.slice(0, limite)) {
    // Mesmo numero cadastrado como cliente em outro card.
    if (await numeroDeCliente(supabase, c.lead.whatsapp as string)) continue;
    const passo = REGUA_AUTOMATICA[c.prox!.indice];
    plano.push({ ...c, passo, texto: passo.texto(primeiroNome(c.lead.nome)) });
  }

  if (ensaio) {
    return NextResponse.json({
      ensaio: true,
      ligado: ligado(),
      enviados_hoje: enviadosHoje ?? 0,
      erro_leads: erroLeads,
      // Por que cada lead do SDR entrou ou nao na rodada.
      diagnostico: todos.map(({ lead, s }) => {
        const prox = proximaDaRegua(s, desde);
        return {
          lead: lead.nome,
          primeiro_contato: s.primeiraNossa,
          respondeu: s.respondeu,
          automaticos: s.automaticos,
          pausado: lead.bot_pausado,
          proxima: prox ? prox.vence.toISOString() : null,
        };
      }),
      mandaria: plano.map((p) => ({
        lead: p.lead.nome,
        passo: `${p.prox!.indice + 1}/${REGUA_AUTOMATICA.length} ${p.passo.titulo}`,
        venceu: p.prox!.vence.toISOString(),
        texto: p.texto,
      })),
    });
  }

  let sent = 0;
  let falhou = 0;
  for (const p of plano) {
    const envio = await sendWhatsAppText(p.lead.whatsapp as string, p.texto);
    if (!envio.ok) {
      // Nao grava nada: a proxima rodada tenta de novo.
      console.error("[cron/followups]", p.lead.id, envio.error);
      falhou++;
      continue;
    }
    await supabase.from("lead_messages").insert({
      lead_id: p.lead.id,
      direction: "outbound",
      body: p.texto,
      wa_message_id: envio.waMessageId ?? null,
      status: "sent",
      raw: { followup: p.passo.key, auto: true },
    });
    sent++;
  }

  return NextResponse.json({
    ok: true,
    sent,
    falhou,
    candidatos: candidatos.length,
    enviados_hoje: (enviadosHoje ?? 0) + sent,
  });
}
