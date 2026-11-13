"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CAMINHO_DO_WEBHOOK,
  NOME_DA_INSTANCIA,
  criarInstancia,
  definirWebhook,
  desconectarInstancia,
  estadoDaInstancia,
  listarInstancias,
  qrParaConectar,
  webhookDaInstancia,
  type Estado,
  type Papel,
} from "@/lib/evolution/instancias";

export type CartaoWhatsApp = {
  papel: Papel;
  nome: string;
  estado: Estado;
  numero: string | null;
  perfil: string | null;
  /** ok | ausente | outro_endereco | sem_segredo | sem_evento */
  webhook: "ok" | "ausente" | "outro_endereco" | "sem_segredo" | "sem_evento";
  webhookUrl: string | null;
  /** So do closer: o que ja chegou do WhatsApp dele. */
  conversas?: { tabelaOk: boolean; mensagens: number; leads: number; ultima: string | null };
};

export type PainelWhatsApp = {
  cartoes: CartaoWhatsApp[];
  erroLista: string | null;
};

async function exigirLogin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

async function urlDoWebhook(papel: Papel) {
  let base = process.env.APP_URL;
  if (!base) {
    const h = await headers();
    base = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  }
  const segredo = process.env.WHATSAPP_WEBHOOK_SECRET;
  return `${base.replace(/\/$/, "")}${CAMINHO_DO_WEBHOOK[papel]}${segredo ? `?token=${segredo}` : ""}`;
}

async function conversasDoCloser() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("closer_messages")
    .select("lead_id, sent_at")
    .order("sent_at", { ascending: false })
    .limit(5000);
  if (error) return { tabelaOk: false, mensagens: 0, leads: 0, ultima: null };
  return {
    tabelaOk: true,
    mensagens: data.length,
    leads: new Set(data.map((m) => m.lead_id)).size,
    ultima: (data[0]?.sent_at as string | undefined) ?? null,
  };
}

export async function carregarWhatsApp(): Promise<PainelWhatsApp | { error: string }> {
  if (!(await exigirLogin())) return { error: "Não autenticado." };
  const segredo = process.env.WHATSAPP_WEBHOOK_SECRET;
  const { instancias, erro } = await listarInstancias();

  const cartoes: CartaoWhatsApp[] = [];
  for (const papel of ["sdr", "closer"] as const) {
    const nome = NOME_DA_INSTANCIA[papel];
    const listada = instancias.find((i) => i.nome === nome);
    const estado = listada?.estado ?? (await estadoDaInstancia(nome));
    const wh = estado === "inexistente" ? null : await webhookDaInstancia(nome, segredo);
    let webhook: CartaoWhatsApp["webhook"] = "ok";
    if (!wh?.url || !wh.ativo) webhook = "ausente";
    else if (!wh.url.includes(CAMINHO_DO_WEBHOOK[papel])) webhook = "outro_endereco";
    else if (segredo && !wh.temSegredo) webhook = "sem_segredo";
    else if (wh.eventos.length && !wh.eventos.some((e) => /MESSAGES_UPSERT/i.test(e))) webhook = "sem_evento";
    cartoes.push({
      papel,
      nome,
      estado,
      numero: listada?.numero ?? null,
      perfil: listada?.perfil ?? null,
      webhook,
      // O token do webhook nunca vai para a tela.
      webhookUrl: wh?.url?.replace(/token=[^&]+/, "token=•••") ?? null,
      ...(papel === "closer" ? { conversas: await conversasDoCloser() } : {}),
    });
  }

  // As outras instancias do servidor (de outros clientes) nao vao para a tela.
  return { cartoes, erroLista: erro ?? null };
}

export async function estadoAtual(papel: Papel): Promise<Estado> {
  if (!(await exigirLogin())) return "desconhecido";
  return estadoDaInstancia(NOME_DA_INSTANCIA[papel]);
}

export async function criarInstanciaDoCloser() {
  if (!(await exigirLogin())) return { error: "Não autenticado." };
  const nome = NOME_DA_INSTANCIA.closer;
  if ((await estadoDaInstancia(nome)) !== "inexistente") {
    return { error: `A instância ${nome} já existe na Evolution. Use "Conectar" para ler o QR code.` };
  }
  const r = await criarInstancia(nome, await urlDoWebhook("closer"));
  if (!r.ok) return { error: r.erro };
  // Algumas versoes nao devolvem o QR na criacao: pede logo em seguida.
  if (r.qr) return { qr: r.qr };
  const q = await qrParaConectar(nome);
  return q.ok ? { qr: q.qr, codigo: q.codigo } : { error: q.erro };
}

export async function pedirQr(papel: Papel) {
  if (!(await exigirLogin())) return { error: "Não autenticado." };
  const nome = NOME_DA_INSTANCIA[papel];
  if ((await estadoDaInstancia(nome)) === "open") return { conectado: true };
  const q = await qrParaConectar(nome);
  return q.ok ? { qr: q.qr, codigo: q.codigo } : { error: q.erro };
}

export async function corrigirWebhook(papel: Papel) {
  if (!(await exigirLogin())) return { error: "Não autenticado." };
  const r = await definirWebhook(NOME_DA_INSTANCIA[papel], await urlDoWebhook(papel));
  return r.ok ? { ok: true } : { error: r.erro };
}

// So o closer: desconectar o SDR para o bot, a regua e o primeiro contato.
export async function desconectarCloser() {
  if (!(await exigirLogin())) return { error: "Não autenticado." };
  const r = await desconectarInstancia(NOME_DA_INSTANCIA.closer);
  return r.ok ? { ok: true } : { error: r.erro };
}
