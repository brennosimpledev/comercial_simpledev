import { NextResponse, type NextRequest } from "next/server";
import { cerebroAtivo, gerarResposta } from "@/lib/bot/cerebro";
import { createAdminClient } from "@/lib/supabase/admin";
import { horariosLivres } from "@/lib/agenda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ensaio do bot: mostra o que ele responderia, sem mandar nada pelo
// WhatsApp e sem marcar reuniao. Os horarios oferecidos sao os livres de
// verdade na agenda; quando o bot decide agendar, a resposta mostra o
// horario que ele escolheria.
//
//   GET  ?secret=...&msg=qual o valor&nome=Brenno&etapa=0
//   POST { secret, nome, etapa, historico: [{autor, texto}] }

async function ensaiar(nome: string, etapa: number, historico: { autor: "cliente" | "nos"; texto: string }[]) {
  const horarios = await horariosLivres(createAdminClient());
  const r = await gerarResposta({ nome, etapa, historico, horarios });
  return {
    bot: r.texto,
    agendaria: r.agendar ? horarios.find((h) => h.iso === r.agendar)?.rotulo ?? r.agendar : null,
    horarios_oferecidos: horarios.map((h) => h.rotulo),
  };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cerebroAtivo()) {
    return NextResponse.json({ erro: "ANTHROPIC_API_KEY não configurada." });
  }
  const msg = q.get("msg") ?? "oi, quanto custa um aplicativo?";
  const r = await ensaiar(q.get("nome") ?? "", Number(q.get("etapa") ?? 0), [
    { autor: "cliente", texto: msg },
  ]);
  return NextResponse.json({ cliente: msg, ...r });
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const body = (await request.json().catch(() => ({}))) as {
    secret?: string;
    nome?: string;
    etapa?: number;
    historico?: { autor: "cliente" | "nos"; texto: string }[];
  };
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cerebroAtivo()) {
    return NextResponse.json({ erro: "ANTHROPIC_API_KEY não configurada." });
  }
  return NextResponse.json(await ensaiar(body.nome ?? "", body.etapa ?? 0, body.historico ?? []));
}
