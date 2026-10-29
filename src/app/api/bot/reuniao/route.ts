import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { horariosLivres } from "@/lib/agenda";
import { cerebroAtivo } from "@/lib/bot/cerebro";
import { decidirSobreReuniao, type ReuniaoEmJogo } from "@/lib/bot/reuniao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ensaio do bot de reuniao: mostra o que ele faria com uma resposta do
// cliente, sem mandar nada e sem mexer na agenda. Os horarios oferecidos
// sao os livres de verdade.
//
//   POST { secret, nome, inicio: ISO, status: "agendada" | "furada",
//          historico: [{autor: "cliente" | "nos", texto}] }

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const secret = process.env.CRON_SECRET;
  if (secret && corpo.secret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cerebroAtivo()) return NextResponse.json({ erro: "ANTHROPIC_API_KEY não configurada." });

  const horarios = await horariosLivres(createAdminClient());
  const reuniao: ReuniaoEmJogo = {
    id: "ensaio",
    lead_id: "ensaio",
    starts_at: corpo.inicio ?? new Date(Date.now() + 86_400_000).toISOString(),
    status: corpo.status === "furada" ? "furada" : "agendada",
    meet_link: "https://meet.google.com/xxx-ensaio",
    confirmacao: null,
    bot_ultima_msg: null,
  };
  const decisao = await decidirSobreReuniao({
    nome: corpo.nome ?? "",
    historico: corpo.historico ?? [],
    reuniao,
    horarios,
  });
  return NextResponse.json({
    decisao,
    remarcaria_para:
      decisao?.tipo === "remarcar" ? horarios.find((h) => h.iso === decisao.iso)?.rotulo : undefined,
    horarios_livres: horarios.map((h) => h.rotulo),
  });
}
