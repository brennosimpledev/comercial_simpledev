import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brCanonical } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Leads que entraram desde uma data e o que aconteceu com cada um no
// WhatsApp — somente leitura.
//
//   GET ?secret=...&desde=2026-10-30T03:00:00Z

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

function quem(m: Msg) {
  if (m.direction === "inbound") return "cliente";
  const r = (m.raw ?? {}) as { followup?: string; lembrete?: string; reuniao?: string; bot?: boolean };
  if (r.followup) return "followup";
  if (r.lembrete) return "lembrete";
  if (r.reuniao) return "bot-reuniao";
  if (r.bot) return "bot";
  return "humano";
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const desde = q.get("desde") ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
  const admin = createAdminClient();

  const { data: leads, error } = await admin
    .from("leads")
    .select("id, nome, whatsapp, origem, created_at, estagio, bot_pausado, ja_cliente, desqualificado")
    .gte("created_at", desde)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (leads ?? []).map((l) => l.id as string);
  const { data: msgs } = await admin
    .from("lead_messages")
    .select("lead_id, direction, created_at, body, raw")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: true })
    .limit(5000);
  const { data: reunioes } = await admin
    .from("meetings")
    .select("lead_id, starts_at, status")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  // Mesmo numero em outro card (formulario + WhatsApp viram dois cards).
  const { data: gemeos } = await admin
    .from("leads")
    .select("id, nome, whatsapp, created_at")
    .gte("created_at", new Date(new Date(desde).getTime() - 60 * 86_400_000).toISOString());
  const gemeoDe = (l: { id: unknown; whatsapp: unknown }) =>
    (gemeos ?? [])
      .filter((g) => g.id !== l.id && brCanonical(g.whatsapp as string | null) === brCanonical(l.whatsapp as string | null))
      .map((g) => `${g.nome} (${hora(g.created_at as string)})`);

  const porLead = new Map<string, Msg[]>();
  for (const m of (msgs ?? []) as Msg[]) porLead.set(m.lead_id, [...(porLead.get(m.lead_id) ?? []), m]);

  const resumo = { total: 0, sem_whatsapp: 0, sem_nenhuma_mensagem: 0, so_cliente_escreveu: 0, contatados: 0, responderam: 0, com_reuniao: 0 };
  const lista = (leads ?? []).map((l) => {
    const ms = porLead.get(l.id as string) ?? [];
    const nossas = ms.filter((m) => m.direction === "outbound");
    const dele = ms.filter((m) => m.direction === "inbound");
    const primeira = nossas[0];
    const reuniao = (reunioes ?? []).find((r) => r.lead_id === l.id);
    resumo.total++;
    if (!l.whatsapp) resumo.sem_whatsapp++;
    if (ms.length === 0) resumo.sem_nenhuma_mensagem++;
    else if (!primeira) resumo.so_cliente_escreveu++;
    if (primeira) resumo.contatados++;
    if (primeira && dele.some((m) => m.created_at > primeira.created_at)) resumo.responderam++;
    if (reuniao) resumo.com_reuniao++;
    return {
      nome: l.nome,
      origem: l.origem,
      chegou: hora(l.created_at as string),
      whatsapp: l.whatsapp ? "sim" : "não",
      estagio: l.estagio,
      pausado: l.bot_pausado,
      msgs: `${nossas.length} nossas / ${dele.length} dele`,
      primeira_nossa: primeira ? `${hora(primeira.created_at)} (${quem(primeira)})` : null,
      outro_card: l.whatsapp ? gemeoDe(l) : [],
      reuniao: reuniao ?`${hora(reuniao.starts_at as string)} ${reuniao.status}` : null,
      conversa: ms.slice(0, 8).map((m) => `${hora(m.created_at)} ${quem(m)}: ${(m.body ?? "").replace(/\s+/g, " ").slice(0, 90)}`),
    };
  });

  return NextResponse.json({ desde, resumo, leads: lista });
}
