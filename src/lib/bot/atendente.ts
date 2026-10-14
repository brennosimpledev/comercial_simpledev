// Atendente de fora de horario - FASE 1.
//
// Regra de ouro: o bot so fala DEPOIS que o lead falou. Ele nunca inicia
// conversa, nunca varre a base, nunca dispara em lote. Se o webhook nao
// receber mensagem do cliente, nada acontece.
//
// Fase 1 faz tres coisas: cumprimenta, puxa duas informacoes do projeto e
// avisa que o time humano retorna pela manha. Nao agenda reuniao.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/evolution/client";

const TZ = "America/Sao_Paulo";

// Desligado por padrao: so roda quando BOT_FASE1 estiver ligado no Vercel.
export function botAtivo() {
  const v = (process.env.BOT_FASE1 ?? "").toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

const HORA_INICIO = Number(process.env.BOT_HORA_INICIO ?? 9);
const HORA_FIM = Number(process.env.BOT_HORA_FIM ?? 18);

// Teto por lead: o bot tem tres falas no roteiro e para.
const MAX_MENSAGENS = 3;
// Mensagens seguidas do cliente nao viram varias respostas.
const INTERVALO_MINIMO_S = 90;
// Se um humano falou ha pouco, a conversa e dele.
const JANELA_HUMANO_MIN = 45;

export function foraDoHorario(agora = new Date()) {
  const local = new Date(agora.toLocaleString("en-US", { timeZone: TZ }));
  const dia = local.getDay();
  const hora = local.getHours();
  if (dia === 0 || dia === 6) return true;
  return hora < HORA_INICIO || hora >= HORA_FIM;
}

const ROTEIRO = [
  (nome: string) =>
    `Oi${nome ? `, ${nome}` : ""}! Aqui é o assistente virtual da SimpleDEV 🤖\n` +
    `O time comercial já está fora do expediente, mas eu adianto o seu atendimento pra não te deixar esperando.\n\n` +
    `Me conta rapidinho: o que você precisa desenvolver?`,
  () =>
    `Entendi! E hoje isso é pra uma empresa que já está rodando ou é um projeto novo?\n\n` +
    `Se puder, me diz também quando pretende começar.`,
  () =>
    `Perfeito, anotei tudo aqui 👊\n` +
    `Amanhã de manhã o Ronaldo, do nosso time, te chama por aqui pra entender os detalhes e ver se faz sentido marcar uma conversa com o especialista.\n\n` +
    `Qualquer coisa que queira adiantar, pode mandar por aqui mesmo.`,
];

type Mensagem = {
  direction: string;
  created_at: string;
  raw: Record<string, unknown> | null;
};

function ehDoBot(m: Mensagem) {
  return Boolean(m.raw && (m.raw as { bot?: boolean }).bot);
}

/**
 * Responde o lead quando for o caso. Nunca lanca: e chamado de dentro do
 * webhook e nao pode derrubar o recebimento da mensagem.
 */
export async function responderForaDeHorario(
  supabase: SupabaseClient,
  leadId: string
): Promise<{ enviou: boolean; motivo?: string }> {
  try {
    if (!botAtivo()) return { enviou: false, motivo: "bot_desligado" };
    if (!foraDoHorario()) return { enviou: false, motivo: "horario_comercial" };

    const { data: lead } = await supabase
      .from("leads")
      .select("id, nome, whatsapp, bot_pausado, ja_cliente")
      .eq("id", leadId)
      .single();
    if (!lead?.whatsapp) return { enviou: false, motivo: "sem_whatsapp" };
    if (lead.bot_pausado) return { enviou: false, motivo: "bot_pausado" };
    if (lead.ja_cliente) return { enviou: false, motivo: "ja_cliente" };

    const { data: msgs } = await supabase
      .from("lead_messages")
      .select("direction, created_at, raw")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(40);

    const lista = (msgs ?? []) as Mensagem[];
    const doBot = lista.filter((m) => m.direction === "outbound" && ehDoBot(m));

    if (doBot.length >= MAX_MENSAGENS) {
      return { enviou: false, motivo: "roteiro_terminado" };
    }

    const agora = Date.now();

    // Humano falando: o bot sai de cena.
    const humanoRecente = lista.find(
      (m) =>
        m.direction === "outbound" &&
        !ehDoBot(m) &&
        agora - new Date(m.created_at).getTime() < JANELA_HUMANO_MIN * 60_000
    );
    if (humanoRecente) return { enviou: false, motivo: "humano_atendendo" };

    // Rajada de mensagens do cliente vira uma resposta so.
    const ultimaDoBot = doBot[0];
    if (
      ultimaDoBot &&
      agora - new Date(ultimaDoBot.created_at).getTime() < INTERVALO_MINIMO_S * 1000
    ) {
      return { enviou: false, motivo: "resposta_recente" };
    }

    const etapa = doBot.length;
    const primeiroNome = (lead.nome ?? "").trim().split(/\s+/)[0] ?? "";
    // Nome generico de numero desconhecido nao vira saudacao.
    const nome = /whatsapp/i.test(primeiroNome) ? "" : primeiroNome;
    const texto = ROTEIRO[etapa](nome);

    const envio = await sendWhatsAppText(lead.whatsapp, texto);
    if (!envio.ok) {
      console.error("[bot] falha ao enviar:", envio.error);
      return { enviou: false, motivo: "falha_envio" };
    }

    await supabase.from("lead_messages").insert({
      lead_id: leadId,
      direction: "outbound",
      body: texto,
      status: "sent",
      raw: { bot: true, etapa: etapa + 1, fase: 1 },
    });

    return { enviou: true };
  } catch (e) {
    console.error("[bot] responderForaDeHorario:", e);
    return { enviou: false, motivo: "erro" };
  }
}
