import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppText, evolutionConfigured } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disparado pelo Vercel Cron (ver vercel.json).
// Envia os follow-ups pendentes cujo horario ja chegou, respeitando
// "bot pausado" e leads desqualificados/fechados.
//
// Tres guardas que faltavam e custaram caro em set/2026, quando a Evolution
// ficou fora do ar por uma semana:
//
//   1. Falha nao grava mensagem. Antes, cada tentativa frustrada inseria
//      uma linha em lead_messages - ~17 mil mensagens fantasma no
//      historico de uns 25 leads.
//   2. Tentativas sao contadas e o follow-up desiste. Antes, o mesmo
//      registro voltava a cada 15 minutos para sempre.
//   3. Teto diario, alem do teto por rodada. 25 por rodada parece
//      prudente e vira 2.400 por dia.

const POR_RODADA = 25;
const TETO_DIARIO = 300;
const MAX_TENTATIVAS = 5;
// Follow-up muito atrasado perdeu o proposito: cobrar alguem sobre uma
// conversa de semanas atras faz mais mal que bem.
const VENCIMENTO_DIAS = 3;

export async function GET(request: NextRequest) {
  // Vercel Cron envia Authorization: Bearer <CRON_SECRET> quando a env existe.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    const query = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${cronSecret}` && query !== cronSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!evolutionConfigured()) {
    return NextResponse.json({ ok: true, skipped: "evolution not configured" });
  }

  const supabase = createAdminClient();
  const agora = new Date();
  const now = agora.toISOString();

  // ---- teto diario ----
  const inicioDoDia = new Date(agora);
  inicioDoDia.setUTCHours(0, 0, 0, 0);

  const { count: enviadosHoje } = await supabase
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("status", "enviado")
    .gte("sent_at", inicioDoDia.toISOString());

  if ((enviadosHoje ?? 0) >= TETO_DIARIO) {
    return NextResponse.json({
      ok: true,
      pausado: "teto diario atingido",
      enviados_hoje: enviadosHoje,
    });
  }

  const restante = TETO_DIARIO - (enviadosHoje ?? 0);
  const limite = Math.min(POR_RODADA, restante);

  const { data: due, error } = await supabase
    .from("follow_ups")
    .select(
      "id, body, lead_id, scheduled_at, tentativas, leads!inner(whatsapp, bot_pausado, desqualificado, estagio)"
    )
    .eq("status", "pendente")
    .lte("scheduled_at", now)
    // Sem ordem explicita o Postgres devolve sempre o mesmo punhado quando
    // ha limite - foi assim que 25 registros viraram 2.400 tentativas/dia.
    .order("scheduled_at", { ascending: true })
    .limit(limite);

  if (error) {
    console.error("[cron/followups]", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const vencidoAntes = new Date(
    agora.getTime() - VENCIMENTO_DIAS * 24 * 60 * 60 * 1000
  );

  let sent = 0;
  let skipped = 0;
  let falhou = 0;
  let vencidos = 0;

  for (const fu of due ?? []) {
    const lead = (fu as unknown as {
      leads: {
        whatsapp: string | null;
        bot_pausado: boolean;
        desqualificado: boolean;
        estagio: string;
      };
    }).leads;

    const parar =
      lead.bot_pausado ||
      lead.desqualificado ||
      lead.estagio === "fechado" ||
      lead.estagio === "perdido" ||
      !lead.whatsapp;

    if (parar) {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelado" })
        .eq("id", fu.id);
      skipped++;
      continue;
    }

    // Atrasado demais: cancela em vez de cobrar fora de hora.
    if (new Date(fu.scheduled_at as string) < vencidoAntes) {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelado", ultimo_erro: "vencido" })
        .eq("id", fu.id);
      vencidos++;
      continue;
    }

    const result = await sendWhatsAppText(lead.whatsapp!, fu.body);

    if (!result.ok) {
      const tentativas = ((fu.tentativas as number) ?? 0) + 1;
      await supabase
        .from("follow_ups")
        .update({
          tentativas,
          ultimo_erro: (result.error ?? "falha desconhecida").slice(0, 500),
          // Desiste depois de algumas tentativas em vez de tentar sempre.
          ...(tentativas >= MAX_TENTATIVAS ? { status: "falhou" } : {}),
        })
        .eq("id", fu.id);
      falhou++;
      continue;
    }

    // So grava mensagem quando de fato saiu.
    await supabase.from("lead_messages").insert({
      lead_id: fu.lead_id,
      direction: "outbound",
      body: fu.body,
      wa_message_id: result.waMessageId ?? null,
      status: "sent",
    });

    await supabase
      .from("follow_ups")
      .update({ status: "enviado", sent_at: new Date().toISOString() })
      .eq("id", fu.id);
    sent++;
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    falhou,
    vencidos,
    total: due?.length ?? 0,
    enviados_hoje: (enviadosHoje ?? 0) + sent,
  });
}
