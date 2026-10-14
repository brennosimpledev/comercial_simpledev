import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Objecoes do cliente e a resposta que o humano deu — somente leitura.
//
//   GET ?secret=...&dias=120&limite=80
//
// Serve de materia-prima para o prompt do bot: em vez de inventar um
// jeito de falar, copia o que o Ronaldo ja responde na pratica.

const GATILHOS = [
  "caro",
  "preço",
  "preco",
  "valor",
  "quanto custa",
  "orçamento",
  "orcamento",
  "investimento",
  "prazo",
  "quanto tempo",
  "demora",
  "pensar",
  "depois",
  "sem condições",
  "sem condicoes",
  "não tenho",
  "nao tenho",
  "barato",
  "concorrente",
  "outra empresa",
  "mais barato",
  "parcel",
  "desconto",
  "garantia",
  "confian",
  "golpe",
  "segur",
];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const q = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 120);
  const limite = Number(request.nextUrl.searchParams.get("limite") ?? 80);
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const linhas: {
    lead_id: string;
    direction: string;
    body: string | null;
    created_at: string;
    raw: Record<string, unknown> | null;
  }[] = [];

  for (let i = 0; i < 20000; i += 1000) {
    const { data } = await admin
      .from("lead_messages")
      .select("lead_id, direction, body, created_at, raw")
      .gte("created_at", inicio)
      .order("lead_id", { ascending: true })
      .order("created_at", { ascending: true })
      .range(i, i + 999);
    if (!data || data.length === 0) break;
    linhas.push(...data);
    if (data.length < 1000) break;
  }

  const pares: { objecao: string; resposta: string; quando: string }[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i];
    if (m.direction !== "inbound" || !m.body) continue;
    const texto = m.body.toLowerCase();
    if (!GATILHOS.some((g) => texto.includes(g))) continue;

    // Junta as falas seguintes do mesmo lead ate o cliente voltar a falar.
    const resposta: string[] = [];
    for (let j = i + 1; j < linhas.length && linhas[j].lead_id === m.lead_id; j++) {
      const n = linhas[j];
      if (n.direction === "inbound") break;
      // Mensagem do bot nao serve de exemplo para treinar o bot.
      if (n.raw && (n.raw as { bot?: boolean }).bot) break;
      if (n.body) resposta.push(n.body.trim());
      if (resposta.join(" ").length > 600) break;
    }
    if (resposta.length === 0) continue;

    pares.push({
      objecao: m.body.slice(0, 300),
      resposta: resposta.join("\n").slice(0, 600),
      quando: m.created_at,
    });
  }

  // Mais recentes primeiro: o jeito de falar de hoje vale mais.
  pares.reverse();

  return NextResponse.json({
    dias,
    mensagens_lidas: linhas.length,
    pares_encontrados: pares.length,
    pares: pares.slice(0, limite),
  });
}
