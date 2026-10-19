import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { entenderMidia, transcricaoAtiva, visaoAtiva } from "@/lib/midia/entender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ensaio da transcricao e da descricao de imagem — somente leitura.
//
//   GET ?secret=...&tipo=audio|image
//
// Pega a midia mais recente desse tipo que um cliente mandou e mostra o
// texto que sairia. Nao grava nada no CRM e nao manda mensagem.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tipo = q.get("tipo") === "image" ? "image" : "audio";
  const admin = createAdminClient();

  const { data: msgs } = await admin
    .from("lead_messages")
    .select("id, created_at, body, raw")
    .eq("direction", "inbound")
    .eq("media_type", tipo)
    .not("raw", "is", null)
    .order("created_at", { ascending: false })
    .limit(3);

  const alvo = (msgs ?? [])[0];
  if (!alvo) {
    return NextResponse.json({ tipo, erro: "Nenhuma mídia desse tipo encontrada." });
  }

  const inicio = Date.now();
  const resultado = await entenderMidia(
    tipo,
    alvo.raw as Record<string, unknown>,
    (alvo.body as string | null) ?? ""
  );

  return NextResponse.json({
    tipo,
    chave_openai: transcricaoAtiva(),
    chave_claude: visaoAtiva(),
    mensagem: alvo.id,
    recebida_em: alvo.created_at,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
    resultado: resultado ?? "(falhou — veja os logs da Vercel)",
  });
}
