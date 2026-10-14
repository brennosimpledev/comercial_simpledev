import { NextResponse, type NextRequest } from "next/server";
import { cerebroAtivo, gerarResposta } from "@/lib/bot/cerebro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ensaio do bot: mostra o que ele responderia, sem mandar nada pelo
// WhatsApp. Serve para ajustar o tom antes de o cliente ver.
//
//   GET  ?secret=...&msg=qual o valor&nome=Brenno&etapa=0
//   POST { secret, nome, etapa, historico: [{autor, texto}] }

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
  const resposta = await gerarResposta({
    nome: q.get("nome") ?? "",
    etapa: Number(q.get("etapa") ?? 0),
    historico: [{ autor: "cliente", texto: msg }],
  });

  return NextResponse.json({ cliente: msg, bot: resposta });
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

  const resposta = await gerarResposta({
    nome: body.nome ?? "",
    etapa: body.etapa ?? 0,
    historico: body.historico ?? [],
  });
  return NextResponse.json({ bot: resposta });
}
