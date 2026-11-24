import { NextResponse, type NextRequest } from "next/server";
import { reportarLeadsNovosOpenAI } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Entrada de lead para a OpenAI (ChatGPT Ads), de qualquer origem. Roda a
// cada 15 min (vercel.json).
//
// O lead do site ja sai na hora pelo webhook; aqui entram os da Meta, do
// WhatsApp e qualquer lead do site que ficou para tras. Sem isto a OpenAI
// fica dias sem evento de servidor e a nota de qualidade do pixel cai (o
// site recebeu 4 leads em novembro; a Meta, 150).
//
//   GET ?secret=...&ensaio=1   lista quem seria enviado, sem enviar
//   GET ?secret=...&validar=1  manda com validate_only: a OpenAI confere o
//                              formato e nao grava; o CRM tambem nao registra

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  const auth = request.headers.get("authorization");
  if (!secret || (auth !== `Bearer ${secret}` && q.get("secret") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await reportarLeadsNovosOpenAI({
    ensaio: q.get("ensaio") === "1",
    validar: q.get("validar") === "1",
  });
  return NextResponse.json(r);
}
