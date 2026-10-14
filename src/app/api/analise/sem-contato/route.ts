import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Por que um lead aparece como "nunca respondido" — somente leitura.
//
//   GET ?secret=...&dias=90
//
// Hipoteses testadas: lead sem telefone, conversa gravada em OUTRO lead
// com o mesmo numero (duplicado), lead que so tem mensagem de entrada, e
// lead que nunca teve mensagem nenhuma no banco.

function soDigitos(v: string | null) {
  return (v ?? "").replace(/\D/g, "");
}

// DDD + 8 ultimos digitos: casa numero com e sem o 9 na frente.
function canonico(v: string | null) {
  const d = soDigitos(v);
  if (!d) return "";
  const sem55 = d.startsWith("55") ? d.slice(2) : d;
  if (sem55.length < 10) return sem55;
  return sem55.slice(0, 2) + sem55.slice(-8);
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

  const dias = Number(request.nextUrl.searchParams.get("dias") ?? 90);
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const { data: leads } = await admin
    .from("leads")
    .select("id, nome, whatsapp, origem, created_at, estagio, qualificado")
    .gte("created_at", inicio)
    .eq("ja_cliente", false);

  const todos = leads ?? [];

  // Mensagens de todos os leads da janela, para saber quem tem o que.
  const msgs: { lead_id: string; direction: string; created_at: string }[] = [];
  for (let i = 0; i < 40000; i += 1000) {
    const { data } = await admin
      .from("lead_messages")
      .select("lead_id, direction, created_at")
      .in("lead_id", todos.map((l) => l.id))
      .range(i, i + 999);
    if (!data || data.length === 0) break;
    msgs.push(...data);
    if (data.length < 1000) break;
  }

  const temOut = new Set<string>();
  const temIn = new Set<string>();
  for (const m of msgs) {
    if (m.direction === "outbound") temOut.add(m.lead_id);
    else temIn.add(m.lead_id);
  }

  // Indice de telefone -> leads, para achar a conversa que foi parar em
  // outro registro do mesmo numero.
  const porTelefone = new Map<string, string[]>();
  for (const l of todos) {
    const c = canonico(l.whatsapp as string | null);
    if (!c) continue;
    porTelefone.set(c, [...(porTelefone.get(c) ?? []), l.id]);
  }

  const semContato = todos.filter((l) => !temOut.has(l.id));

  const motivos = {
    sem_telefone: 0,
    conversa_em_lead_duplicado: 0,
    so_mensagem_de_entrada: 0,
    nenhuma_mensagem_no_banco: 0,
  };
  const porOrigem: Record<string, number> = {};
  const porMes: Record<string, number> = {};
  const exemplos: { nome: string; origem: string; criado: string; motivo: string }[] = [];

  for (const l of semContato) {
    const c = canonico(l.whatsapp as string | null);
    const gemeosComConversa = (porTelefone.get(c) ?? []).filter(
      (id) => id !== l.id && temOut.has(id)
    );

    let motivo: keyof typeof motivos;
    if (!c) motivo = "sem_telefone";
    else if (gemeosComConversa.length > 0) motivo = "conversa_em_lead_duplicado";
    else if (temIn.has(l.id)) motivo = "so_mensagem_de_entrada";
    else motivo = "nenhuma_mensagem_no_banco";

    motivos[motivo]++;
    porOrigem[l.origem as string] = (porOrigem[l.origem as string] ?? 0) + 1;
    const mes = (l.created_at as string).slice(0, 7);
    porMes[mes] = (porMes[mes] ?? 0) + 1;

    if (exemplos.length < 15) {
      exemplos.push({
        nome: (l.nome as string) ?? "",
        origem: l.origem as string,
        criado: (l.created_at as string).slice(0, 10),
        motivo,
      });
    }
  }

  return NextResponse.json({
    dias,
    leads_na_janela: todos.length,
    sem_mensagem_nossa: semContato.length,
    motivos,
    por_origem: porOrigem,
    por_mes: porMes,
    exemplos,
  });
}
