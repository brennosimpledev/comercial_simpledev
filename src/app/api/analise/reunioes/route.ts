import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamAccessToken } from "@/lib/google/tokens";
import { findMeetFiles } from "@/lib/google/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Reunioes de um periodo, com o lead e o texto da transcricao do Meet —
// somente leitura. Serve para comparar a qualidade de quem chega na reuniao.
//
//   GET ?secret=...&desde=2026-10-15T03:00:00Z&ate=...&texto=1&max=6000
//
// A transcricao vem do link salvo na reuniao ou, sem link, da busca no Drive
// pelo nome do lead (mesma busca da tela de reunioes).

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

async function textoDoDoc(token: string, docId: string, max: number) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return `[erro ${r.status} ao ler a transcricao]`;
  return (await r.text()).replace(/\s+\n/g, "\n").slice(0, max);
}

async function transcricao(token: string | null, link: string | null, nome: string, startsAt: string, max: number) {
  const doc = link?.match(/\/document\/d\/([\w-]+)/)?.[1];
  if (doc && token) return textoDoDoc(token, doc, max);
  if (link && /\.(txt|vtt|srt)(\?|$)/i.test(link)) {
    const r = await fetch(link);
    return r.ok ? (await r.text()).slice(0, max) : `[erro ${r.status} ao ler a transcricao]`;
  }
  if (!token) return null;
  const achados = await findMeetFiles(token, { leadNome: nome, startsAt });
  const t = achados.files?.find((f) => f.tipo === "transcricao");
  return t ? textoDoDoc(token, t.id, max) : null;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const desde = q.get("desde") ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const ate = q.get("ate") ?? new Date().toISOString();
  const comTexto = q.get("texto") === "1";
  const max = Math.min(Number(q.get("max") ?? 6000), 300000);
  const admin = createAdminClient();

  const { data: reunioes, error } = await admin
    .from("meetings")
    .select(
      "id, lead_id, starts_at, status, resumo, transcricao, leads(nome, origem, utm_content, necessidade, anotacoes, estagio, status, qualificado, desqualificado, bot_avaliacao, valor_fechado, ja_cliente, created_at)"
    )
    .gte("starts_at", desde)
    .lte("starts_at", ate)
    .order("starts_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const token = comTexto ? await getTeamAccessToken() : null;
  const lista = [];
  for (const r of reunioes ?? []) {
    const l = (r.leads ?? {}) as unknown as Record<string, unknown>;
    lista.push({
      quando: hora(r.starts_at as string),
      status: r.status,
      lead: l.nome,
      origem: l.origem,
      anuncio: l.utm_content,
      lead_chegou: l.created_at ? hora(l.created_at as string) : null,
      estagio: l.estagio,
      lead_status: l.status,
      qualificado: l.qualificado,
      desqualificado: l.desqualificado,
      bot_avaliacao: l.bot_avaliacao,
      valor_fechado: l.valor_fechado,
      ja_cliente: l.ja_cliente,
      necessidade: l.necessidade,
      anotacoes: ((l.anotacoes as string | null) ?? "").slice(0, 1500),
      resumo: r.resumo,
      transcricao_link: r.transcricao,
      transcricao:
        comTexto && r.status === "realizada"
          ? await transcricao(token, r.transcricao as string | null, String(l.nome ?? ""), r.starts_at as string, max)
          : undefined,
    });
  }
  return NextResponse.json({ desde, ate, reunioes: lista });
}
