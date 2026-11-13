import { NextResponse, type NextRequest } from "next/server";
import { NOME_DA_INSTANCIA } from "@/lib/evolution/instancias";
import { variantesBR } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostico do WhatsApp do closer — somente leitura. Conta o que a
// Evolution guardou e testa a busca de um numero (sem devolver texto de
// mensagem).
//
//   GET ?secret=...&numero=5562...

const BASE = process.env.EVOLUTION_API_URL;
const CHAVE = process.env.EVOLUTION_GLOBAL_API_KEY || process.env.EVOLUTION_API_KEY;
const INST = encodeURIComponent(NOME_DA_INSTANCIA.closer);

async function post(caminho: string, corpo: unknown) {
  const res = await fetch(`${BASE}${caminho}/${INST}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CHAVE ?? "" },
    body: JSON.stringify(corpo),
    cache: "no-store",
  });
  return { status: res.status, dados: (await res.json().catch(() => null)) as unknown };
}

function total(d: unknown) {
  const m = (d as { messages?: { total?: number; records?: unknown[] } | unknown[] } | null)?.messages;
  if (Array.isArray(m)) return m.length;
  return m?.total ?? m?.records?.length ?? 0;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const numero = request.nextUrl.searchParams.get("numero") ?? "";

  const geral = await post("/chat/findMessages", { where: {}, page: 1, offset: 5 });
  const chats = await post("/chat/findChats", {});
  const lista = Array.isArray(chats.dados) ? (chats.dados as Record<string, unknown>[]) : [];
  const tipos: Record<string, number> = {};
  for (const c of lista) {
    const jid = String(c.remoteJid ?? c.id ?? "");
    const t = jid.split("@")[1] ?? "?";
    tipos[t] = (tipos[t] ?? 0) + 1;
  }

  const busca: Record<string, number> = {};
  if (numero) {
    for (const n of variantesBR(numero)) {
      const r = await post("/chat/findMessages", { where: { key: { remoteJid: `${n}@s.whatsapp.net` } }, page: 1, offset: 5 });
      busca[`${n.slice(0, 4)}…${n.slice(-4)}@s.whatsapp.net`] = total(r.dados);
    }
    // Chat do numero com jid @lid (o WhatsApp esconde o numero).
    const fim = numero.replace(/\D/g, "").slice(-8);
    const doNumero = lista.filter((c) => JSON.stringify(c).includes(fim));
    busca.chats_que_citam_o_numero = doNumero.length;
    busca.jids_desses_chats = doNumero.length;
    for (const c of doNumero) {
      const jid = String(c.remoteJid ?? "");
      const r = await post("/chat/findMessages", { where: { key: { remoteJid: jid } }, page: 1, offset: 5 });
      busca[`via_${jid.split("@")[1]}`] = total(r.dados);
    }
  }

  return NextResponse.json({
    instancia: NOME_DA_INSTANCIA.closer,
    status_mensagens: geral.status,
    mensagens_no_servidor: total(geral.dados),
    status_chats: chats.status,
    chats: lista.length,
    chats_por_tipo: tipos,
    busca,
  });
}
