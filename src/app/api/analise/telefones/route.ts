import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  consultarNumeros,
  fetchWhatsAppHistory,
  toWaNumber,
  variantesBR,
} from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Confere no WhatsApp os leads que nao tem nenhuma mensagem no CRM.
//
//   GET ?secret=...&dias=90&offset=0&limite=25            (so leitura)
//   GET ?secret=...&dias=90&offset=0&limite=25&aplicar=1  (corrige o telefone)
//
// Para cada lead: o numero tem WhatsApp? com qual formato? existe conversa
// nessa conta? Nada aqui envia mensagem: a consulta de numero e a busca
// de historico sao leituras na Evolution.
//
// "aplicar" so troca o telefone quando o WhatsApp confirmou outro formato
// do MESMO numero (com/sem o 9, com/sem 55). Nunca inventa numero.

function digitos(v: string | null) {
  return (v ?? "").replace(/\D/g, "");
}

// Formato esperado: 55 + DDD (11-99) + 8 ou 9 digitos.
function formatoValido(raw: string | null) {
  const d = toWaNumber(raw ?? "");
  if (d.length !== 12 && d.length !== 13) return false;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return false;
  if (d.length === 13 && d[4] !== "9") return false;
  return true;
}

type Resultado = {
  nome: string;
  criado: string;
  telefone_cadastro: string | null;
  formato_valido: boolean;
  tem_whatsapp: boolean;
  numero_real: string | null;
  conversa: { total: number; nossas: number; deles: number; ultima: string | null };
  acao: string;
};

async function emLotes<T, R>(itens: T[], tamanho: number, fn: (t: T) => Promise<R>) {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return saida;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}` && q.get("secret") !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dias = Number(q.get("dias") ?? 90);
  const offset = Number(q.get("offset") ?? 0);
  const limite = Math.min(Number(q.get("limite") ?? 25), 40);
  const aplicar = q.get("aplicar") === "1";
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = createAdminClient();

  const { data: leads } = await admin
    .from("leads")
    .select("id, nome, whatsapp, created_at")
    .gte("created_at", inicio)
    .eq("ja_cliente", false)
    .order("created_at", { ascending: false });

  const todos = leads ?? [];

  // Quem tem pelo menos uma mensagem registrada fica de fora. O Supabase
  // devolve no maximo 1000 linhas por consulta: sem paginar, lead com
  // conversa longa empurra os outros para fora e eles parecem "sem mensagem".
  const comMensagem = new Set<string>();
  for (let i = 0; i < todos.length; i += 100) {
    const fatia = todos.slice(i, i + 100).map((l) => l.id);
    for (let p = 0; ; p += 1000) {
      const { data } = await admin
        .from("lead_messages")
        .select("lead_id")
        .in("lead_id", fatia)
        .range(p, p + 999);
      if (!data || data.length === 0) break;
      for (const m of data) comMensagem.add(m.lead_id as string);
      if (data.length < 1000) break;
    }
  }

  const alvo = todos.filter((l) => !comMensagem.has(l.id));
  const pagina = alvo.slice(offset, offset + limite);

  const resultados = await emLotes(pagina, 5, async (l): Promise<Resultado> => {
    const original = (l.whatsapp as string | null) ?? null;
    const base: Resultado = {
      nome: (l.nome as string) ?? "",
      criado: (l.created_at as string).slice(0, 10),
      telefone_cadastro: original,
      formato_valido: formatoValido(original),
      tem_whatsapp: false,
      numero_real: null,
      conversa: { total: 0, nossas: 0, deles: 0, ultima: null },
      acao: "nenhuma",
    };
    if (!digitos(original)) return { ...base, acao: "sem_telefone" };

    const respostas = await consultarNumeros(variantesBR(original!));
    const achado = respostas.find((r) => r.exists && r.jid);
    if (!achado) return { ...base, acao: "numero_sem_whatsapp" };

    const real = digitos(achado.jid!.split("@")[0]);
    const historico = await fetchWhatsAppHistory(real, [achado.jid!], 1);
    const nossas = historico.filter((m) => m.key?.fromMe).length;
    const ultimaTs = historico
      .map((m) => Number(m.messageTimestamp ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);

    const resultado: Resultado = {
      ...base,
      tem_whatsapp: true,
      numero_real: real,
      conversa: {
        total: historico.length,
        nossas,
        deles: historico.length - nossas,
        ultima: ultimaTs ? new Date(ultimaTs * 1000).toISOString().slice(0, 10) : null,
      },
    };

    const precisaTrocar = real !== toWaNumber(original!);
    if (!precisaTrocar) return { ...resultado, acao: "telefone_ok" };

    if (!aplicar) return { ...resultado, acao: "trocaria_telefone" };

    const { error } = await admin.from("leads").update({ whatsapp: real }).eq("id", l.id);
    return { ...resultado, acao: error ? `erro_ao_trocar: ${error.message}` : "telefone_trocado" };
  });

  const resumo = {
    sem_telefone: 0,
    numero_sem_whatsapp: 0,
    telefone_ok: 0,
    trocaria_telefone: 0,
    telefone_trocado: 0,
    com_conversa_no_whatsapp: 0,
    com_mensagem_nossa_no_whatsapp: 0,
  };
  for (const r of resultados) {
    if (r.acao in resumo) resumo[r.acao as keyof typeof resumo]++;
    if (r.conversa.total > 0) resumo.com_conversa_no_whatsapp++;
    if (r.conversa.nossas > 0) resumo.com_mensagem_nossa_no_whatsapp++;
  }

  return NextResponse.json({
    total_sem_mensagem_no_crm: alvo.length,
    offset,
    limite,
    proximo_offset: offset + limite < alvo.length ? offset + limite : null,
    aplicou: aplicar,
    resumo,
    leads: resultados,
  });
}
