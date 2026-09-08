import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolutionConfigured } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostico da conexao com o WhatsApp.
//
// Checa os dois sentidos, que falham de formas diferentes:
//
//   saida   - a instancia da Evolution responde e esta conectada ao celular
//   entrada - o webhook esta recebendo mensagem de verdade
//
// A segunda importa porque a instancia pode estar "open" e o webhook estar
// apontando para o lugar errado - nesse caso nada entra e nada acusa erro.
//
//   GET ?secret=<CRON_SECRET>

const BASE = process.env.EVOLUTION_API_URL;
const INSTANCE = process.env.EVOLUTION_INSTANCE;
const API_KEY = process.env.EVOLUTION_API_KEY;

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return (
    auth === `Bearer ${secret}` ||
    request.nextUrl.searchParams.get("secret") === secret
  );
}

async function chamar(caminho: string) {
  const res = await fetch(`${BASE}${caminho}`, {
    headers: { apikey: API_KEY ?? "" },
    cache: "no-store",
  });
  const texto = await res.text();
  let corpo: unknown = texto;
  try {
    corpo = JSON.parse(texto);
  } catch {
    /* mantem texto cru */
  }
  return { status: res.status, corpo };
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!evolutionConfigured()) {
    return NextResponse.json({
      configurado: false,
      falta: {
        EVOLUTION_API_URL: Boolean(BASE),
        EVOLUTION_INSTANCE: Boolean(INSTANCE),
        EVOLUTION_API_KEY: Boolean(API_KEY),
      },
    });
  }

  // ---- saida: a instancia esta de pe e pareada? ----
  let conexao: unknown = null;
  let erroSaida: string | null = null;
  try {
    const r = await chamar(`/instance/connectionState/${INSTANCE}`);
    conexao = r.corpo;
    if (r.status >= 400) erroSaida = `HTTP ${r.status}`;
  } catch (e) {
    erroSaida = String(e).slice(0, 300);
  }

  // ---- webhook: para onde a Evolution manda os eventos? ----
  let webhook: unknown = null;
  try {
    const r = await chamar(`/webhook/find/${INSTANCE}`);
    webhook = r.corpo;
  } catch {
    webhook = null;
  }

  // ---- entrada: chegou mensagem de verdade? ----
  const admin = createAdminClient();

  const { data: ultima } = await admin
    .from("lead_messages")
    .select("created_at, direction")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: ultimaSaida } = await admin
    .from("lead_messages")
    .select("created_at")
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: entradas24h } = await admin
    .from("lead_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .gte("created_at", desde);

  const { count: saidas24h } = await admin
    .from("lead_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .gte("created_at", desde);

  const horas = (iso?: string | null) =>
    iso ? +((Date.now() - new Date(iso).getTime()) / 3_600_000).toFixed(1) : null;

  return NextResponse.json({
    configurado: true,
    instancia: INSTANCE,
    saida: { conexao, erro: erroSaida },
    webhook,
    entrada: {
      ultima_recebida: ultima?.created_at ?? null,
      horas_atras: horas(ultima?.created_at),
      recebidas_24h: entradas24h ?? 0,
    },
    envio: {
      ultima_enviada: ultimaSaida?.created_at ?? null,
      horas_atras: horas(ultimaSaida?.created_at),
      enviadas_24h: saidas24h ?? 0,
    },
  });
}
