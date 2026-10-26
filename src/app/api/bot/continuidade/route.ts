import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { montarContinuidade } from "@/lib/bot/continuidade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ensaio da mensagem de continuidade — somente leitura.
//
//   GET ?secret=...&lead=<id>
//
// Volta ao momento logo antes da primeira mensagem humana do lead e mostra
// o que o botao "Sugerir mensagem" teria proposto, ao lado do que o time
// mandou de verdade. Nao envia nada e nao grava nada.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const leadId = q.get("lead");
  if (!leadId) return NextResponse.json({ error: "informe lead" }, { status: 400 });

  const admin = createAdminClient();
  const { data: msgs } = await admin
    .from("lead_messages")
    .select("direction, body, raw, created_at")
    .eq("lead_id", leadId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: true })
    .limit(60);

  const primeiraHumana = (msgs ?? []).find(
    (m) => !(m.raw && (m.raw as { bot?: boolean }).bot)
  );
  // Sem fala humana ainda: o ensaio e o caso real, com a conversa inteira.
  const antesDe = primeiraHumana?.created_at ?? new Date().toISOString();

  const sugestao = await montarContinuidade(admin, leadId, { antesDe });

  return NextResponse.json({
    momento: antesDe,
    enviada_de_verdade: primeiraHumana?.body ?? null,
    sugestao: sugestao.texto ?? null,
    erro: sugestao.error ?? null,
  });
}
