// Atendente de fora de horario - FASE 1.
//
// Regra de ouro: o bot so fala DEPOIS que o lead falou. Ele nunca inicia
// conversa, nunca varre a base, nunca dispara em lote. Se o webhook nao
// receber mensagem do cliente, nada acontece.
//
// E o bot so cuida do PRIMEIRO atendimento: lead que ja conversou com
// alguem do time, que tem reuniao ou que ja saiu do estagio de SDR e
// conversa de gente. Na primeira semana ele atropelou um cliente fechando
// contrato e outro com reuniao marcada; nao pode acontecer de novo.
//
// Fase 1: conversa, colhe o projeto, avisa que o time retorna de manha e
// deixa um resumo nas anotacoes do lead. Nao agenda reuniao.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/evolution/client";
import { cerebroAtivo, gerarResposta, gerarResumo } from "@/lib/bot/cerebro";

const TZ = "America/Sao_Paulo";

// Desligado por padrao: so roda quando BOT_FASE1 estiver ligado no Vercel.
export function botAtivo() {
  const v = (process.env.BOT_FASE1 ?? "").toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

// O Ronaldo ja esta no WhatsApp antes das 8h; comecar as 9h fazia o bot
// responder por cima dele.
const HORA_INICIO = Number(process.env.BOT_HORA_INICIO ?? 8);
const HORA_FIM = Number(process.env.BOT_HORA_FIM ?? 18);

const MAX_MENSAGENS = Number(process.env.BOT_MAX_MENSAGENS ?? 6);

// Quanto esperar o cliente terminar de escrever antes de responder. Quem
// manda tres mensagens seguidas recebe uma resposta so, para as tres.
const ESPERA_MS = Number(process.env.BOT_ESPERA_MS ?? 9000);

// So estes estagios sao territorio do bot.
const ESTAGIOS_DO_BOT = ["novo", "sdr"];

export function foraDoHorario(agora = new Date()) {
  const local = new Date(agora.toLocaleString("en-US", { timeZone: TZ }));
  const dia = local.getDay();
  const hora = local.getHours();
  if (dia === 0 || dia === 6) return true;
  return hora < HORA_INICIO || hora >= HORA_FIM;
}

// Rede de seguranca para quando a IA falha. Na primeira fala, apresenta;
// depois disso, so encerra - repetir pergunta generica no meio da conversa
// e pior do que ficar quieto.
const ABERTURA = (nome: string) =>
  `Oi${nome ? `, ${nome}` : ""}! Aqui é o assistente da SimpleDEV.\n` +
  `O time comercial já está fora do expediente, mas eu adianto o seu atendimento pra não te deixar esperando.\n\n` +
  `Me conta rapidinho: o que você precisa desenvolver?`;
const ENCERRAMENTO =
  `Anotei tudo aqui 👊\n` +
  `Amanhã de manhã o time comercial te chama por aqui pra continuar de onde paramos.`;

type Mensagem = {
  direction: string;
  created_at: string;
  raw: Record<string, unknown> | null;
  body?: string | null;
  media_type?: string | null;
  wa_message_id?: string | null;
};

function ehDoBot(m: Mensagem) {
  return Boolean(m.raw && (m.raw as { bot?: boolean }).bot);
}

const NOME_MIDIA: Record<string, string> = {
  image: "uma imagem",
  imagem: "uma imagem",
  audio: "um áudio",
  video: "um vídeo",
  document: "um documento",
  documento: "um documento",
  sticker: "uma figurinha",
};

function textoDaFala(m: Mensagem) {
  const corpo = (m.body ?? "").trim();
  if (corpo) return corpo.slice(0, 1200);
  if (m.media_type) {
    return `[enviou ${NOME_MIDIA[m.media_type] ?? "um arquivo"}]`;
  }
  return "";
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Responde o lead quando for o caso. Nunca lanca: roda depois da resposta
 * do webhook e nao pode derrubar nada.
 *
 * `gatilho` e o wa_message_id da mensagem que acordou o bot. Depois da
 * espera, se chegou mensagem mais nova do cliente, este disparo desiste e
 * deixa o da mensagem nova responder por todas.
 */
export async function responderForaDeHorario(
  supabase: SupabaseClient,
  leadId: string,
  gatilho?: string | null
): Promise<{ enviou: boolean; motivo?: string }> {
  try {
    if (!botAtivo()) return { enviou: false, motivo: "bot_desligado" };
    if (!foraDoHorario()) return { enviou: false, motivo: "horario_comercial" };

    const { data: lead } = await supabase
      .from("leads")
      .select("id, nome, whatsapp, bot_pausado, ja_cliente, estagio, anotacoes")
      .eq("id", leadId)
      .single();
    if (!lead?.whatsapp) return { enviou: false, motivo: "sem_whatsapp" };
    if (lead.bot_pausado) return { enviou: false, motivo: "bot_pausado" };
    if (lead.ja_cliente) return { enviou: false, motivo: "ja_cliente" };
    if (!ESTAGIOS_DO_BOT.includes(lead.estagio as string)) {
      return { enviou: false, motivo: "fora_do_estagio_do_bot" };
    }

    const { count: reunioes } = await supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId);
    if ((reunioes ?? 0) > 0) return { enviou: false, motivo: "tem_reuniao" };

    // Qualquer fala humana, em qualquer momento, tira o bot da conversa.
    const { count: falasHumanas } = await supabase
      .from("lead_messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("direction", "outbound")
      .or("raw.is.null,raw->>bot.is.null");
    if ((falasHumanas ?? 0) > 0) return { enviou: false, motivo: "ja_atendido_por_humano" };

    // Espera o cliente terminar de escrever.
    await espera(ESPERA_MS);

    const { data: msgs } = await supabase
      .from("lead_messages")
      .select("direction, created_at, raw, body, media_type, wa_message_id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(40);

    const lista = (msgs ?? []) as Mensagem[];
    const ultima = lista[0];

    // Chegou mensagem nova depois desta: quem responde e o disparo dela.
    if (gatilho && ultima?.direction === "inbound" && ultima.wa_message_id !== gatilho) {
      return { enviou: false, motivo: "cliente_ainda_escrevendo" };
    }
    // A ultima fala ja e nossa: nao ha nada novo para responder.
    if (!ultima || ultima.direction !== "inbound") {
      return { enviou: false, motivo: "nada_novo" };
    }
    // Humano entrou durante a espera.
    if (lista.some((m) => m.direction === "outbound" && !ehDoBot(m))) {
      return { enviou: false, motivo: "ja_atendido_por_humano" };
    }

    const doBot = lista.filter((m) => m.direction === "outbound" && ehDoBot(m));
    if (doBot.length >= MAX_MENSAGENS) {
      return { enviou: false, motivo: "teto_de_mensagens" };
    }

    const etapa = doBot.length;
    const primeiroNome = (lead.nome ?? "").trim().split(/\s+/)[0] ?? "";
    // Nome generico de numero desconhecido nao vira saudacao.
    const nome = /whatsapp/i.test(primeiroNome) ? "" : primeiroNome;

    const historico = [...lista]
      .reverse()
      .map((m) => ({
        autor: m.direction === "inbound" ? ("cliente" as const) : ("nos" as const),
        texto: textoDaFala(m),
      }))
      .filter((f) => f.texto)
      .slice(-14);

    let texto: string | null = null;
    let viaIa = false;
    if (cerebroAtivo()) {
      texto = await gerarResposta({ nome, historico, etapa });
      viaIa = Boolean(texto);
    }
    if (!texto) {
      const jaEncerrou = doBot.some((m) => (m.body ?? "") === ENCERRAMENTO);
      if (etapa === 0) texto = ABERTURA(nome);
      else if (!jaEncerrou) texto = ENCERRAMENTO;
      else return { enviou: false, motivo: "ia_falhou_e_ja_encerrou" };
    }

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
      wa_message_id: envio.waMessageId ?? null,
      raw: { bot: true, etapa: etapa + 1, fase: 1, ia: viaIa },
    });

    await atualizarResumo(supabase, leadId, (lead.anotacoes as string | null) ?? "", [
      ...historico,
      { autor: "nos" as const, texto },
    ]);

    return { enviou: true };
  } catch (e) {
    console.error("[bot] responderForaDeHorario:", e);
    return { enviou: false, motivo: "erro" };
  }
}

// O resumo fica num bloco proprio dentro das anotacoes: o bot reescreve so
// esse trecho e nunca toca no que o time escreveu.
const INICIO_BLOCO = "--- Atendimento do bot ---";
const FIM_BLOCO = "--- fim do resumo do bot ---";

async function atualizarResumo(
  supabase: SupabaseClient,
  leadId: string,
  anotacoes: string,
  historico: { autor: "cliente" | "nos"; texto: string }[]
) {
  const resumo = await gerarResumo(historico);
  if (!resumo) return;

  const quando = new Date().toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bloco = `${INICIO_BLOCO}\n(${quando})\n${resumo}\n${FIM_BLOCO}`;

  const i = anotacoes.indexOf(INICIO_BLOCO);
  const f = anotacoes.indexOf(FIM_BLOCO);
  const novas =
    i !== -1 && f !== -1 && f > i
      ? anotacoes.slice(0, i) + bloco + anotacoes.slice(f + FIM_BLOCO.length)
      : anotacoes.trim()
        ? `${bloco}\n\n${anotacoes.trim()}`
        : bloco;

  await supabase.from("leads").update({ anotacoes: novas }).eq("id", leadId);
}
