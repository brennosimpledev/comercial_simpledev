import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mensagens automaticas (regua de follow-up, lembretes de reuniao, bot) e o
// que aconteceu em volta delas na conversa — somente leitura.
//
//   GET ?secret=...&horas=24

type Msg = {
  lead_id: string;
  direction: string;
  created_at: string;
  body: string | null;
  raw: Record<string, unknown> | null;
};

function quem(m: Msg) {
  if (m.direction === "inbound") return "cliente";
  const r = (m.raw ?? {}) as { followup?: string; lembrete?: string; reuniao?: string; bot?: boolean; key?: unknown };
  if (r.followup) return `AUTO:followup ${r.followup}`;
  if (r.lembrete) return `AUTO:lembrete ${r.lembrete}`;
  if (r.reuniao) return "AUTO:bot-reuniao";
  if (r.bot) return "AUTO:bot";
  return "humano";
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const horas = Number(q.get("horas") ?? 24);
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  const admin = createAdminClient();

  const { data: autos } = await admin
    .from("lead_messages")
    .select("lead_id, direction, created_at, body, raw")
    .eq("direction", "outbound")
    .gte("created_at", desde)
    .or("raw->>followup.not.is.null,raw->>lembrete.not.is.null,raw->>bot.not.is.null")
    .order("created_at", { ascending: true });

  const ids = [...new Set((autos ?? []).map((m) => m.lead_id as string))];
  const conversas = [];
  for (const id of ids) {
    const [{ data: lead }, { data: msgs }] = await Promise.all([
      admin.from("leads").select("nome, whatsapp, estagio").eq("id", id).single(),
      admin
        .from("lead_messages")
        .select("lead_id, direction, created_at, body, raw")
        .eq("lead_id", id)
        .gte("created_at", new Date(Date.now() - (horas + 48) * 3600_000).toISOString())
        .order("created_at", { ascending: true })
        .limit(80),
    ]);
    conversas.push({
      lead: lead?.nome,
      estagio: lead?.estagio,
      fone_final: String(lead?.whatsapp ?? "").slice(-4),
      mensagens: ((msgs ?? []) as Msg[]).map((m) => ({
        quando: new Date(m.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        quem: quem(m),
        texto: (m.body ?? "").replace(/\s+/g, " ").slice(0, 140),
      })),
    });
  }
  return NextResponse.json({ automaticas: autos?.length ?? 0, conversas });
}
