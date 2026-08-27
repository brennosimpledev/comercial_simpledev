import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota temporaria de diagnostico da integracao com o Google Ads.
// Nao expoe segredo: developer token e client secret viram booleano, e os
// IDs de conta nao sao credencial. Remover quando o upload estiver estavel.
export async function GET() {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/\D/g, "");
  const loginCustomerId =
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "");

  return NextResponse.json({
    marcador: "v3-data-manager",
    customerId: customerId ?? null,
    loginCustomerId: loginCustomerId ?? null,
    acaoQualificado: process.env.GOOGLE_ADS_ACTION_QUALIFICADO ?? null,
    acaoFechado: process.env.GOOGLE_ADS_ACTION_FECHADO ?? null,
    endpoint: "https://datamanager.googleapis.com/v1/events:ingest",
  });
}
