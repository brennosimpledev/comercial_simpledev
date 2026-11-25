import { NextResponse, type NextRequest } from "next/server";
import { tokenDaPaginaReserva } from "@/lib/meta/leadgen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARIO (24/11/2026): mudanca de regiao e de formulario na CA 02.
//
// Faz uma chamada a Graph API com o token do usuario de sistema (ou com o
// token da pagina, com "com": "pagina"). Existe so para montar o formulario
// novo e o conjunto novo, pausados; sai do codigo quando a mudanca terminar.
// Nao apaga nada (so GET e POST) e nunca devolve token.
//
//   POST ?secret=...   { caminho: "id" | "id/aresta", metodo?: "GET",
//                        com?: "pagina", params?: {...} }

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const corpo = (await request.json().catch(() => ({}))) as {
    caminho?: string;
    metodo?: string;
    com?: string;
    params?: Record<string, unknown>;
  };
  const caminho = corpo.caminho ?? "";
  if (!/^[0-9a-z_]+([/][a-z_]+)?$/i.test(caminho)) {
    return NextResponse.json({ error: "caminho invalido" }, { status: 400 });
  }
  const token = corpo.com === "pagina" ? await tokenDaPaginaReserva() : process.env.META_ADS_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "sem token" }, { status: 500 });

  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(corpo.params ?? {})) {
    p.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  p.set("access_token", token);
  const url = `${GRAPH}/${caminho}`;
  try {
    const r =
      corpo.metodo === "GET"
        ? await fetch(`${url}?${p.toString()}`, { cache: "no-store" })
        : await fetch(url, { method: "POST", body: p, cache: "no-store" });
    const texto = (await r.text())
      .replace(/access_token=[^&"]+/g, "access_token=OCULTO")
      .replace(/"access_token":"[^"]*"/g, '"access_token":"OCULTO"');
    let resposta: unknown = texto;
    try {
      resposta = JSON.parse(texto);
    } catch {}
    return NextResponse.json({ status: r.status, resposta });
  } catch (e) {
    return NextResponse.json({ status: 0, resposta: String(e).slice(0, 300) });
  }
}
