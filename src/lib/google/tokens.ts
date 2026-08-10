import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAccessToken } from "./oauth";

// Retorna um access_token valido do usuario (renova via refresh_token se preciso).
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("google_accounts")
    .select("refresh_token, access_token, token_expiry")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.refresh_token) return null;

  const now = Date.now();
  const expiry = data.token_expiry
    ? new Date(data.token_expiry).getTime()
    : 0;

  // Ainda valido (com margem de 60s).
  if (data.access_token && expiry > now + 60_000) {
    return data.access_token;
  }

  const r = await refreshAccessToken(data.refresh_token);
  if (!r.access_token) return null;

  const newExpiry = new Date(now + (r.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from("google_accounts")
    .update({ access_token: r.access_token, token_expiry: newExpiry })
    .eq("user_id", userId);

  return r.access_token;
}

// Busca um access_token de qualquer conta Google conectada (conta da equipe).
// Permite que qualquer membro autenticado agende reunioes na agenda principal.
export async function getTeamAccessToken(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data } = await supabase
    .from("google_accounts")
    .select("user_id, refresh_token, access_token, token_expiry")
    .limit(1)
    .maybeSingle();

  if (!data?.refresh_token) return null;

  const now = Date.now();
  const expiry = data.token_expiry
    ? new Date(data.token_expiry).getTime()
    : 0;

  if (data.access_token && expiry > now + 60_000) {
    return data.access_token;
  }

  const r = await refreshAccessToken(data.refresh_token);
  if (!r.access_token) return null;

  const newExpiry = new Date(now + (r.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from("google_accounts")
    .update({ access_token: r.access_token, token_expiry: newExpiry })
    .eq("user_id", data.user_id);

  return r.access_token;
}
