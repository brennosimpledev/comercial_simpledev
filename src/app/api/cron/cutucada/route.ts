import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolutionConfigured } from "@/lib/evolution/client";
import { enviarCutucada, podeCutucarAgora, quemCutucar } from "@/lib/bot/cutucada";
import { podeResgatarAgora, resgatar, semRespostaDoBot } from "@/lib/bot/resgate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lembrete unico para quem parou de responder ao bot fora do expediente.
// Roda a cada 15 minutos (vercel.json); as regras estao em
// lib/bot/cutucada.ts.
//
//   GET ?secret=...&ensaio=1  -> lista quem receberia agora, sem enviar
//   GET (cron) / ?secret=...  -> envia

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}` && q.get("secret") !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const ensaio = q.get("ensaio") === "1";
  const bloqueio = podeCutucarAgora();
  const supabase = createAdminClient();

  // Antes da cutucada: quem escreveu fora do expediente e ficou sem
  // resposta do bot ganha nova tentativa (lib/bot/resgate.ts). Vale a
  // qualquer hora fora do expediente, nao so das 7h as 22h: e resposta a
  // quem acabou de escrever, nao mensagem nossa do nada.
  const bloqueioResgate = podeResgatarAgora();
  const semResposta = ensaio ? await semRespostaDoBot(supabase) : [];
  const resgatados =
    !ensaio && !bloqueioResgate && evolutionConfigured() ? await resgatar(supabase) : [];

  if (!ensaio) {
    if (bloqueio) return NextResponse.json({ ok: true, skipped: bloqueio, resgatados });
    if (!evolutionConfigured()) return NextResponse.json({ ok: true, skipped: "evolution not configured" });
  }

  const { plano, pulados } = await quemCutucar(supabase);

  if (ensaio) {
    return NextResponse.json({
      ensaio: true,
      enviaria_agora: !bloqueio,
      bloqueio,
      pulados,
      resgate: { bloqueio: bloqueioResgate, sem_resposta_do_bot: semResposta.map((p) => ({ lead: p.nome, desde: p.desde })) },
      mandaria: plano.map((p) => ({ lead: p.nome, ultima_nossa: p.ultimaNossa, texto: p.texto })),
    });
  }

  const resultado = [];
  for (const p of plano) {
    const r = await enviarCutucada(supabase, p);
    if (!r.ok) console.error("[cron/cutucada]", p.leadId, r.motivo);
    resultado.push({ lead: p.nome, ...r });
  }
  return NextResponse.json({ ok: true, enviados: resultado.filter((r) => r.ok).length, resultado, pulados, resgatados });
}
