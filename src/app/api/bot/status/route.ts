import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { botAtivo, foraDoHorario } from "@/lib/bot/atendente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Painel do atendente de fora de horario — somente leitura.
//
//   GET ?secret=...&dias=7
//
// Diz se o bot está ligado, se agora é horário de atuação dele, e lista o
// que ele falou no período com o resultado de cada conversa.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const q = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 7);
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const { data: msgs } = await admin
    .from("lead_messages")
    .select("lead_id, body, created_at, raw, leads(nome, estagio, qualificado)")
    .eq("direction", "outbound")
    .gte("created_at", inicio)
    .order("created_at", { ascending: false })
    .limit(200);

  const doBot = (msgs ?? []).filter(
    (m) => m.raw && (m.raw as { bot?: boolean }).bot
  );

  const leads = new Set(doBot.map((m) => m.lead_id));

  // Quantos desses leads responderam depois da fala do bot.
  let responderam = 0;
  for (const leadId of leads) {
    const falaDoBot = doBot
      .filter((m) => m.lead_id === leadId)
      .map((m) => new Date(m.created_at).getTime())
      .sort((a, b) => a - b)[0];
    const { count } = await admin
      .from("lead_messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("direction", "inbound")
      .gt("created_at", new Date(falaDoBot).toISOString());
    if ((count ?? 0) > 0) responderam++;
  }

  // ?detalhe=1: a conversa inteira de cada lead que o bot atendeu, para
  // avaliar a qualidade das respostas e nao so a contagem.
  let conversas: unknown[] | undefined;
  if (request.nextUrl.searchParams.get("detalhe") === "1") {
    conversas = [];
    for (const leadId of leads) {
      const primeira = doBot
        .filter((m) => m.lead_id === leadId)
        .map((m) => new Date(m.created_at).getTime())
        .sort((a, b) => a - b)[0];
      const desde = new Date(primeira - 6 * 3600_000).toISOString();

      const [{ data: lead }, { data: fio }, { data: mtgs }] = await Promise.all([
        admin
          .from("leads")
          .select("nome, origem, estagio, qualificado, desqualificado, ja_cliente, created_at")
          .eq("id", leadId)
          .single(),
        admin
          .from("lead_messages")
          .select("direction, body, media_type, created_at, raw")
          .eq("lead_id", leadId)
          .gte("created_at", desde)
          .order("created_at", { ascending: true })
          .limit(60),
        admin.from("meetings").select("starts_at, status, created_at").eq("lead_id", leadId),
      ]);

      conversas.push({
        lead,
        reunioes: mtgs ?? [],
        mensagens: (fio ?? []).map((m) => ({
          quando: m.created_at,
          quem:
            m.direction === "inbound"
              ? "cliente"
              : m.raw && (m.raw as { bot?: boolean }).bot
                ? `bot${(m.raw as { ia?: boolean }).ia ? "_ia" : ""}`
                : "humano",
          texto: (m.body ?? (m.media_type ? `[${m.media_type}]` : "")).slice(0, 700),
        })),
      });
    }
  }

  return NextResponse.json({
    ...(conversas ? { conversas } : {}),
    ligado: botAtivo(),
    agora_e_fora_de_horario: foraDoHorario(),
    janela: `${process.env.BOT_HORA_INICIO ?? 9}h às ${process.env.BOT_HORA_FIM ?? 18}h, dias úteis`,
    dias,
    conversas_atendidas: leads.size,
    mensagens_enviadas: doBot.length,
    responderam_depois_do_bot: responderam,
    ultimas: doBot.slice(0, 20).map((m) => ({
      quando: m.created_at,
      lead: (m.leads as unknown as { nome?: string })?.nome ?? null,
      etapa: (m.raw as { etapa?: number }).etapa ?? null,
      trecho: (m.body ?? "").slice(0, 60),
    })),
  });
}
