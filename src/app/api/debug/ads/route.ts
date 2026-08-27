import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota temporaria de diagnostico da integracao com o Google Ads.
// Nao expoe segredo: developer token e client secret viram booleano, e os
// IDs de conta nao sao credencial. Remover quando o upload estiver estavel.
export async function GET() {
  const version = process.env.GOOGLE_ADS_API_VERSION ?? "v26";
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/\D/g, "");
  const loginCustomerId =
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "");

  return NextResponse.json({
    marcador: "v2-com-url-no-erro",
    version,
    customerId: customerId ?? null,
    loginCustomerId: loginCustomerId ?? null,
    temDeveloperToken: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    acaoQualificado: process.env.GOOGLE_ADS_ACTION_QUALIFICADO ?? null,
    acaoFechado: process.env.GOOGLE_ADS_ACTION_FECHADO ?? null,
    urlQueSeriaChamada:
      `https://googleads.googleapis.com/${version}` +
      `/customers/${customerId}:uploadClickConversions`,
  });
}
