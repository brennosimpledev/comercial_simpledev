import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tudo de um periodo para avaliar o bot — somente leitura: os leads que
// entraram, a conversa inteira, como o bot avaliou cada um e o que subiu
// para Meta/Google (inclusive de leads mais antigos).
//
//   GET ?secret=...&desde=2026-11-06T21:00:00Z&ate=2026-11-09T15:00:00Z

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function quem(direction: string, raw: Record<string, unknown> | null) {
  if (direction === "inbound") return "LEAD";
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.primeiro_contato) return "BOT-1o";
  if (r.followup) return "REGUA";
  if (r.lembrete) return "LEMBRETE";
  if (r.reuniao) return "BOT-REUNIAO";
  if (r.bot) return "BOT";
  return "HUMANO";
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const desde = q.get("desde") ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
  const ate = q.get("ate") ?? new Date().toISOString();
  const admin = createAdminClient();

  const { data: leads, error } = await admin
    .from("leads")
    .select(
      "id, nome, origem, estagio, status, qualificado, desqualificado, bot_avaliacao, bot_pausado, ja_cliente, necessidade, anotacoes, utm_content, meta_lead_id, ctwa_clid, created_at"
    )
    .gte("created_at", desde)
    .lte("created_at", ate)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (leads ?? []).map((l) => l.id as string);
  const vazio = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: msgs }, { data: reunioes }, { data: conversoes }] = await Promise.all([
    admin
      .from("lead_messages")
      .select("lead_id, direction, body, media_type, raw, created_at")
      .in("lead_id", ids.length ? ids : vazio)
      .order("created_at", { ascending: true })
      .limit(5000),
    admin
      .from("meetings")
      .select("lead_id, starts_at, status")
      .in("lead_id", ids.length ? ids : vazio),
    // Tudo o que foi enviado no periodo, de qualquer lead.
    admin
      .from("ads_conversions")
      .select("lead_id, tipo, canal, status, valor, erro, created_at")
      .gte("created_at", desde)
      .lte("created_at", ate)
      .order("created_at", { ascending: true }),
  ]);

  const deFora = [...new Set((conversoes ?? []).map((c) => c.lead_id as string))].filter((id) => !ids.includes(id));
  const { data: outros } = deFora.length
    ? await admin.from("leads").select("id, nome, estagio, created_at").in("id", deFora)
    : { data: [] };
  const nomeDe = new Map<string, string>([
    ...(leads ?? []).map((l) => [l.id as string, l.nome as string] as [string, string]),
    ...(outros ?? []).map((l) => [l.id as string, `${l.nome} (lead de ${hora(l.created_at as string)})`] as [string, string]),
  ]);

  const lista = (leads ?? []).map((l) => ({
    id: l.id,
    nome: l.nome,
    origem: l.origem,
    anuncio: l.utm_content,
    canal: l.meta_lead_id ? "formulario" : l.ctwa_clid ? "ctwa" : null,
    chegou: hora(l.created_at as string),
    estagio: l.estagio,
    status: l.status,
    qualificado: l.qualificado,
    desqualificado: l.desqualificado,
    bot_avaliacao: l.bot_avaliacao,
    pausado: l.bot_pausado,
    ja_cliente: l.ja_cliente,
    necessidade: l.necessidade,
    anotacoes: l.anotacoes,
    reunioes: (reunioes ?? [])
      .filter((r) => r.lead_id === l.id)
      .map((r) => `${hora(r.starts_at as string)} ${r.status}`),
    retorno: (conversoes ?? [])
      .filter((c) => c.lead_id === l.id)
      .map((c) => `${c.tipo}/${c.canal}: ${c.status}${c.erro ? ` (${c.erro})` : ""}`),
    conversa: (msgs ?? [])
      .filter((m) => m.lead_id === l.id)
      .map(
        (m) =>
          `${hora(m.created_at as string)} ${quem(m.direction as string, m.raw as Record<string, unknown> | null)}: ${
            ((m.body as string | null) ?? "").replace(/\s+/g, " ").slice(0, 600) || `[${m.media_type ?? "sem texto"}]`
          }`
      ),
  }));

  return NextResponse.json({
    desde,
    ate,
    leads: lista,
    retorno_no_periodo: (conversoes ?? []).map((c) => ({
      lead: nomeDe.get(c.lead_id as string) ?? c.lead_id,
      tipo: c.tipo,
      canal: c.canal,
      status: c.status,
      valor: c.valor,
      erro: c.erro,
      quando: hora(c.created_at as string),
    })),
  });
}
