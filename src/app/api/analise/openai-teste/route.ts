import { NextResponse, type NextRequest } from "next/server";
import { enviarEventoOpenAI, openaiConfigurado } from "@/lib/openai/conversions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Testa a chave da API de conversoes do ChatGPT Ads com um lead_created em
// modo validate_only: a OpenAI confere o formato e a chave e nao grava nada.
//
//   GET ?secret=...

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!openaiConfigurado()) {
    return NextResponse.json({
      ok: false,
      falta: [
        !process.env.OPENAI_ADS_PIXEL_ID && "OPENAI_ADS_PIXEL_ID",
        !process.env.OPENAI_ADS_CAPI_KEY && "OPENAI_ADS_CAPI_KEY",
      ].filter(Boolean),
    });
  }
  const r = await enviarEventoOpenAI({
    tipo: "lead",
    eventId: `teste_${Date.now()}`,
    quando: new Date(),
    leadId: "teste-crm",
    email: "teste@simpledev.com.br",
    soValidar: true,
  });
  return NextResponse.json({ validacao: r });
}
