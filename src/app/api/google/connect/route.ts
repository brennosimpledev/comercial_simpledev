import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { buildAuthUrl, googleConfigured } from "@/lib/google/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inicia o fluxo OAuth: redireciona para o consentimento do Google.
export async function GET(request: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth não configurado (env vars)." },
      { status: 500 }
    );
  }

  const next = request.nextUrl.searchParams.get("next") ?? "/leads";
  const state = crypto.randomUUID();

  const res = NextResponse.redirect(buildAuthUrl(state));
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  res.cookies.set("g_oauth_state", state, opts);
  res.cookies.set("g_oauth_next", next, opts);
  return res;
}
