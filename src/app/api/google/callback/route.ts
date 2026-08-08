import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, emailFromIdToken } from "@/lib/google/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Callback do OAuth: troca o code por tokens e salva a conexao do usuario.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("g_oauth_state")?.value;
  const next = request.cookies.get("g_oauth_next")?.value ?? "/leads";

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/leads?google=erro", url.origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const tokens = await exchangeCode(code);
  if (tokens.error || !tokens.refresh_token) {
    return NextResponse.redirect(
      new URL(`${next}?google=sem_refresh`, url.origin)
    );
  }

  const email = emailFromIdToken(tokens.id_token);
  const expiry = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000
  ).toISOString();

  await supabase.from("google_accounts").upsert({
    user_id: user.id,
    email,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? null,
    token_expiry: expiry,
    updated_at: new Date().toISOString(),
  });

  const res = NextResponse.redirect(new URL(`${next}?google=ok`, url.origin));
  res.cookies.delete("g_oauth_state");
  res.cookies.delete("g_oauth_next");
  return res;
}
