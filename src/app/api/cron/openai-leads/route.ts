import { NextResponse, type NextRequest } from "next/server";
import { reportarLeadsBrutosMeta, reportarLeadsNovosOpenAI } from "@/lib/conversions/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Entrada de lead para a OpenAI (ChatGPT Ads), de qualquer origem, e lead
// bruto de formulario para a Meta. Roda a cada 15 min (vercel.json).
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
  const ensaio = q.get("ensaio") === "1";
  const validar = q.get("validar") === "1";
  const openai = await reportarLeadsNovosOpenAI({ ensaio, validar });
  // Lead bruto de formulario para a Meta: o estagio inicial que a integracao
  // de CRM exige para todo lead (cobertura minima de 60%). Na validacao da
  // OpenAI so conta, nao envia. ?meta_limite=1 manda um so, para conferir.
  const limite = Number(q.get("meta_limite") ?? 0) || undefined;
  const meta = await reportarLeadsBrutosMeta({ ensaio: ensaio || validar, limite });
  return NextResponse.json({ ...openai, meta });
}
