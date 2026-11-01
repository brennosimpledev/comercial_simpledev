import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolutionConfigured } from "@/lib/evolution/client";
import { enviarPrimeiroContato, podeChamarAgora, quemChamar } from "@/lib/bot/primeiroContato";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Primeiro contato com lead de formulario que nao chamou no WhatsApp.
// Roda a cada 5 minutos (vercel.json); as regras estao em
// lib/bot/primeiroContato.ts.
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
  const bloqueio = podeChamarAgora();
  if (!ensaio) {
    if (bloqueio) return NextResponse.json({ ok: true, skipped: bloqueio });
    if (!evolutionConfigured()) return NextResponse.json({ ok: true, skipped: "evolution not configured" });
  }

  const supabase = createAdminClient();
  const { plano, pulados } = await quemChamar(supabase);

  if (ensaio) {
    return NextResponse.json({
      ensaio: true,
      enviaria_agora: !bloqueio,
      bloqueio,
      pulados,
      mandaria: plano.map((p) => ({ lead: p.lead.nome, chegou: p.lead.created_at, texto: p.texto })),
    });
  }

  const resultado = [];
  for (const p of plano) {
    const r = await enviarPrimeiroContato(supabase, p);
    if (!r.ok) console.error("[cron/primeiro-contato]", p.lead.id, r.motivo);
    resultado.push({ lead: p.lead.nome, ...r });
  }
  return NextResponse.json({ ok: true, enviados: resultado.filter((r) => r.ok).length, resultado, pulados });
}
