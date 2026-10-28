import { createClient } from "@/lib/supabase/server";
export async function sessionUser() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw Error("Não autenticado");
  return { db, user };
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const requestUrl = new URL(req.url);
  const firstHeaderValue = (value: string | null) =>
    value?.split(",", 1)[0].trim();
  const host =
    firstHeaderValue(req.headers.get("x-forwarded-host")) ??
    req.headers.get("host");
  const protocol =
    firstHeaderValue(req.headers.get("x-forwarded-proto")) ??
    requestUrl.protocol.slice(0, -1);
  const expectedOrigin = host
    ? `${protocol}://${host}`
    : requestUrl.origin;
  if (!origin || origin !== expectedOrigin)
    throw Error("Origem inválida");
}
export async function readJson(req: Request) {
  const raw = await req.text();
  if (raw.length > 2_000_000) throw Error("Documento excede 2 MB");
  return JSON.parse(raw);
}
export function failure(e: unknown) {
  return Response.json(
    { error: e instanceof Error ? e.message : "Falha na operação" },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
