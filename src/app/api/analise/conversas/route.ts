import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Leitura das conversas para estudo — somente leitura, nada e alterado.
//
// Serve para desenhar o script do bot a partir do que o SDR ja faz: quais
// perguntas antecedem uma reuniao marcada, onde a conversa morre, que
// palavras a pessoa usa.
//
//   GET ?secret=...&estagio=reuniao_marcada&limite=6&min=4
//
// `ja_cliente` fica de fora por padrao: sao cobrancas e suporte, nao venda.

interface Msg {
  direction: "inbound" | "outbound";
  body: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const q = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const p = request.nextUrl.searchParams;
  const estagio = p.get("estagio");
  const limite = Math.min(Number(p.get("limite") ?? 6), 20);
  // Conversa curta demais nao ensina nada sobre script.
  const minMensagens = Number(p.get("min") ?? 4);
  const incluirClientes = p.get("clientes") === "1";

  const admin = createAdminClient();

  let q = admin
    .from("leads")
    .select("id, nome, origem, estagio, qualificado, created_at")
    .order("created_at", { ascending: false })
    .limit(120);

  if (estagio) q = q.eq("estagio", estagio);
  if (!incluirClientes) q = q.eq("ja_cliente", false);

  const { data: leads } = await q;
  if (!leads?.length) return NextResponse.json({ conversas: [] });

  const conversas: Array<Record<string, unknown>> = [];

  for (const lead of leads) {
    if (conversas.length >= limite) break;

    const { data: msgs } = await admin
      .from("lead_messages")
      .select("direction, body, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true })
      .limit(60);

    const uteis = (msgs ?? []).filter((m) => (m as Msg).body?.trim());
    if (uteis.length < minMensagens) continue;

    conversas.push({
      lead: (lead.id as string).slice(0, 8),
      // So o primeiro nome: o resto nao ajuda a escrever script.
      nome: String(lead.nome ?? "").split(" ")[0],
      origem: lead.origem,
      estagio: lead.estagio,
      qualificado: lead.qualificado,
      mensagens: uteis.length,
      transcricao: uteis.map((m) => {
        const msg = m as Msg;
        const quem = msg.direction === "inbound" ? "LEAD" : "SDR ";
        const hora = new Date(msg.created_at).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        });
        return `${quem} ${hora} | ${(msg.body ?? "").replace(/\s+/g, " ").trim()}`;
      }),
    });
  }

  return NextResponse.json({
    filtro: { estagio, incluirClientes, minMensagens },
    total: conversas.length,
    conversas,
  });
}
