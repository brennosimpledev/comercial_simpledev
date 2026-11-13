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

  // Formato (so nomes de campos e dominio dos jids, sem conteudo).
  const forma = (o: unknown, prof = 0): unknown => {
    if (o === null || typeof o !== "object" || prof > 2) {
      if (typeof o === "string" && o.includes("@")) return "…@" + o.split("@")[1];
      return typeof o;
    }
    if (Array.isArray(o)) return [forma(o[0], prof + 1)];
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, forma(v, prof + 1)]));
  };
  const umaMsg = ((geral.dados as { messages?: { records?: unknown[] } })?.messages?.records ?? [])[0];
  const contatos = await post("/chat/findContacts", {});
  const listaC = Array.isArray(contatos.dados) ? (contatos.dados as unknown[]) : [];
  const fim8 = numero.replace(/\D/g, "").slice(-8);

  // Varre as mensagens procurando o numero em qualquer campo (remoteJidAlt,
  // senderPn...).
  let achadas = 0;
  const camposComNumero = new Set<string>();
  if (fim8) {
    for (let page = 1; page <= 10; page++) {
      const r = await post("/chat/findMessages", { where: {}, page, offset: 250 });
      const recs = ((r.dados as { messages?: { records?: Record<string, unknown>[] } })?.messages?.records ?? []);
      for (const m of recs) {
        const key = (m.key ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(key)) {
          if (typeof v === "string" && v.includes(fim8)) {
            achadas++;
            camposComNumero.add(`key.${k}=…@${v.split("@")[1] ?? ""}`);
          }
        }
      }
      if (recs.length < 250) break;
    }
  }

  // O WhatsApp devolve o @lid do numero? E o contato do numero tem o mesmo
  // nome de algum contato @lid?
  const wn = fim8 ? await post("/chat/whatsappNumbers", { numbers: [numero.replace(/\D/g, "")] }) : null;
  const contatoDoNumero = fim8
    ? (listaC.find((c) => JSON.stringify(c).includes(fim8)) as Record<string, unknown> | undefined)
    : undefined;
  const nome = contatoDoNumero?.pushName as string | undefined;
  const lidsMesmoNome = nome
    ? (listaC as Record<string, unknown>[]).filter((c) => c.pushName === nome && String(c.remoteJid).endsWith("@lid"))
    : [];
  const msgsDoLid: Record<string, number> = {};
  for (const c of lidsMesmoNome.slice(0, 3)) {
    const r = await post("/chat/findMessages", { where: { key: { remoteJid: String(c.remoteJid) } }, page: 1, offset: 5 });
    msgsDoLid[`lid_${Object.keys(msgsDoLid).length + 1}`] = total(r.dados);
  }

  return NextResponse.json({
    whatsapp_numbers: wn ? forma(wn.dados) : null,
    contato_do_numero: forma(contatoDoNumero),
    contato_tem_nome: Boolean(nome),
    lids_com_mesmo_nome: lidsMesmoNome.length,
    msgs_do_lid: msgsDoLid,
    forma_chat: forma(lista[0]),
    forma_msg: forma(umaMsg),
    contatos: listaC.length,
    forma_contato: forma(listaC.find((c) => JSON.stringify(c).includes("@lid")) ?? listaC[0]),
    contatos_que_citam_o_numero: fim8 ? listaC.filter((c) => JSON.stringify(c).includes(fim8)).length : null,
    msgs_com_numero_na_key: achadas,
    campos_com_numero: Array.from(camposComNumero),
    instancia: NOME_DA_INSTANCIA.closer,
    status_mensagens: geral.status,
    mensagens_no_servidor: total(geral.dados),
    status_chats: chats.status,
    chats: lista.length,
    chats_por_tipo: tipos,
    busca,
  });
}
