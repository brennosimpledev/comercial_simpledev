import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cerebroAtivo, gerarResposta, gerarResumo } from "@/lib/bot/cerebro";
import { horariosLivres } from "@/lib/agenda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ensaio guiado com conversas reais — somente leitura.
//
//   GET ?secret=...&dias=10                -> lista os leads que o bot atendeu
//   GET ?secret=...&lead=<id>              -> refaz a conversa desse lead
//
// Para cada momento em que o cliente falou e o bot respondeu, mostra a
// resposta que o bot deu de verdade e a que o prompt ATUAL daria com o
// mesmo historico. No fim, gera o resumo atual da conversa. Nao envia nada
// pelo WhatsApp e nao grava nada no CRM.

type Linha = {
  direction: string;
  body: string | null;
  media_type: string | null;
  created_at: string;
  raw: Record<string, unknown> | null;
};

const ehDoBot = (m: Linha) => Boolean(m.raw && (m.raw as { bot?: boolean }).bot);

function texto(m: Linha) {
  const corpo = (m.body ?? "").trim();
  if (corpo) return corpo.slice(0, 1200);
  return m.media_type ? `[enviou ${m.media_type}]` : "";
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cerebroAtivo()) {
    return NextResponse.json({ erro: "ANTHROPIC_API_KEY não configurada." });
  }

  const admin = createAdminClient();
  const leadId = q.get("lead");

  if (!leadId) {
    const dias = Number(q.get("dias") ?? 10);
    const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
    const { data } = await admin
      .from("lead_messages")
      .select("lead_id, created_at, raw, leads(nome)")
      .eq("direction", "outbound")
      .gte("created_at", inicio)
      .order("created_at", { ascending: false })
      .limit(300);
    const vistos = new Map<string, string>();
    for (const m of data ?? []) {
      if (!(m.raw && (m.raw as { bot?: boolean }).bot)) continue;
      if (!vistos.has(m.lead_id as string)) {
        vistos.set(m.lead_id as string, (m.leads as unknown as { nome?: string })?.nome ?? "");
      }
    }
    return NextResponse.json({
      leads: [...vistos].map(([id, nome]) => ({ id, nome })),
    });
  }

  const [{ data: lead }, { data: msgs }] = await Promise.all([
    admin.from("leads").select("nome").eq("id", leadId).single(),
    admin
      .from("lead_messages")
      .select("direction, body, media_type, created_at, raw")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(80),
  ]);

  // So o trecho que o bot atendeu: para na primeira fala humana.
  const conversa: Linha[] = [];
  for (const m of (msgs ?? []) as Linha[]) {
    if (m.direction === "outbound" && !ehDoBot(m)) break;
    conversa.push(m);
  }

  const historico = conversa
    .map((m) => ({
      autor: m.direction === "inbound" ? ("cliente" as const) : ("nos" as const),
      texto: texto(m),
    }))
    .filter((f) => f.texto);

  const primeiroNome = ((lead?.nome as string) ?? "").trim().split(/\s+/)[0] ?? "";
  const nome = /whatsapp/i.test(primeiroNome) ? "" : primeiroNome;

  // Momentos em que o bot respondeu: o historico ate ali vira a entrada.
  const momentos: { ate: number; etapa: number; real: string }[] = [];
  let etapa = 0;
  historico.forEach((f, i) => {
    if (f.autor === "nos" && i > 0 && historico[i - 1].autor === "cliente") {
      momentos.push({ ate: i, etapa, real: f.texto });
    }
    if (f.autor === "nos") etapa++;
  });

  // Horarios livres de agora: o ensaio mostra o que o bot ofereceria hoje.
  const horarios = await horariosLivres(admin);

  const [rodadas, resumo] = await Promise.all([
    Promise.all(
      momentos.slice(0, 6).map(async (mo) => {
        // As falas seguidas do cliente logo antes da resposta do bot.
        const falas: string[] = [];
        for (let j = mo.ate - 1; j >= 0 && historico[j].autor === "cliente"; j--) {
          falas.unshift(historico[j].texto);
        }
        return {
          cliente: falas.join(" | "),
          bot_de_verdade: mo.real,
          bot_hoje: await gerarResposta({
            nome,
            historico: historico.slice(0, mo.ate),
            etapa: mo.etapa,
            horarios,
          }).then((r) =>
            r.agendar
              ? `[AGENDARIA: ${horarios.find((h) => h.iso === r.agendar)?.rotulo ?? r.agendar}]`
              : r.texto
          ),
        };
      })
    ),
    gerarResumo(historico),
  ]);

  return NextResponse.json({
    nome: lead?.nome ?? null,
    falas_no_trecho_do_bot: historico.length,
    rodadas,
    resumo_hoje: resumo ? `${resumo.resumo}
CODIGO: ${resumo.codigo ?? "?"}` : null,
  });
}
