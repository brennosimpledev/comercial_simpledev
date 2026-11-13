// Proximo passo do lead no Funil, sugerido pela IA. SERVER-ONLY.
//
// Le tudo o que o CRM sabe do lead (conversa no WhatsApp do closer e do
// SDR, follow-ups registrados, documentos, reunioes e a transcricao da
// ultima reuniao) e devolve: em que pe esta, o que ficou combinado, o que
// ficou para tras (ex.: pediu ligacao e ninguem ligou), o follow-up
// sugerido e um rascunho de mensagem. Nada e enviado daqui.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTeamAccessToken } from "@/lib/google/tokens";
import { textoDaTranscricao } from "@/lib/google/transcricao";
import { STAGE_LABELS, type LeadStage } from "@/types/database";

const MODELO = process.env.PROXIMO_PASSO_MODELO ?? "claude-opus-5-5";
const FUSO = "America/Sao_Paulo";

export type CanalFollowup = "whatsapp" | "ligacao" | "email" | "reuniao";

export type ProximoPasso = {
  situacao: string;
  alerta: string | null;
  combinados: { acao: string; quando: string | null; quem: "closer" | "cliente" }[];
  followup: {
    data: string;
    canal: CanalFollowup;
    motivo: string;
    pedido_do_cliente: boolean;
  } | null;
  mensagem: string | null;
  // Preenchidos pelo servidor, nao pela IA.
  transcricao_de?: string | null;
};

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["situacao", "alerta", "combinados", "followup", "mensagem"],
  properties: {
    situacao: {
      type: "string",
      description: "Onde a negociação está hoje, em 2 ou 3 frases curtas e concretas.",
    },
    alerta: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Algo que ficou para trás e precisa de ação: promessa nossa não cumprida (ex.: ele pediu ligação na segunda e ninguém ligou), pergunta do cliente sem resposta, prazo combinado vencido. null se não houver.",
    },
    combinados: {
      type: "array",
      description: "Próximos passos combinados ou necessários, do mais urgente ao menos. No máximo 4.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["acao", "quando", "quem"],
        properties: {
          acao: { type: "string" },
          quando: {
            anyOf: [{ type: "string", description: "AAAA-MM-DD" }, { type: "null" }],
          },
          quem: { type: "string", enum: ["closer", "cliente"] },
        },
      },
    },
    followup: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["data", "canal", "motivo", "pedido_do_cliente"],
          properties: {
            data: { type: "string", description: "AAAA-MM-DD, hoje ou no futuro." },
            canal: { type: "string", enum: ["whatsapp", "ligacao", "email", "reuniao"] },
            motivo: {
              type: "string",
              description: "O que fazer nesse contato, em uma frase (vira o registro do follow-up).",
            },
            pedido_do_cliente: {
              type: "boolean",
              description: "true quando o próprio cliente pediu ou combinou essa data/canal.",
            },
          },
        },
        { type: "null" },
      ],
    },
    mensagem: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Rascunho da próxima mensagem do Brenno no WhatsApp, quando a próxima ação for mandar mensagem. null se a próxima ação não for mensagem.",
    },
  },
} as const;

const SISTEMA = `Você é o assistente comercial do Brenno, closer da SimpleDev (software sob medida; projetos a partir de R$ 20 mil, com entrada e parcelas).
Você recebe tudo o que o CRM sabe de um lead que já está no funil do closer e organiza o próximo passo.

Como pensar:
- Leia primeiro a transcrição da última reunião (quando houver) e a conversa do WhatsApp do closer: é ali que ficam os combinados ("vou apresentar pro conselho quinta", "me liga segunda").
- Datas relativas ("segunda", "semana que vem", "depois do feriado") viram datas reais a partir da data em que foram ditas, não a partir de hoje.
- Compare o que foi combinado com o que aconteceu depois. Se o cliente pediu ligação/retorno numa data que já passou e não há sinal de que aconteceu (mensagem nossa, follow-up registrado, reunião), isso é o alerta.
- O follow-up sugerido é o próximo contato do Brenno: a data certa (a combinada, ou a que faz sentido pelo momento da negociação), o canal e o motivo. Nunca no passado: se a data combinada já passou, sugira hoje.
- Se já existe um retorno marcado que continua fazendo sentido, repita essa data.
- Lead perdido, desqualificado ou fechado: só sugira follow-up se houver um motivo real (ex.: fechado e falta a entrada).
- Não invente fatos. Se a informação não está no material, não use.

A mensagem sugerida:
- Escrita como o Brenno escreve no WhatsApp: curta, direta, cordial, sem formalidade de e-mail, no máximo 3 frases.
- Retoma o ponto concreto em que a conversa parou, com as palavras do cliente quando possível.
- Termina com uma pergunta fácil de responder.
- Sem emojis em excesso, sem "prezado", sem assinatura.

Escreva tudo em português do Brasil.`;

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: FUSO,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hojeISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: FUSO });
}

type Contexto = { chave: string; texto: string; reuniaoParaTranscricao: { id: string; transcricao: string | null; starts_at: string } | null; nome: string };

// Junta o material e calcula a chave (muda quando chega algo novo).
export async function montarContexto(admin: SupabaseClient, leadId: string): Promise<Contexto | null> {
  const { data: lead } = await admin
    .from("leads")
    .select("id, nome, estagio, estagio_em, anotacoes, proximo_contato, valor_fechado, necessidade")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return null;

  const [closer, sdr, contatos, reunioes, arquivos] = await Promise.all([
    admin
      .from("closer_messages")
      .select("id, direction, body, media_type, sent_at")
      .eq("lead_id", leadId)
      .order("sent_at", { ascending: false })
      .limit(120),
    admin
      .from("lead_messages")
      .select("id, direction, body, media_type, created_at, raw")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(40),
    admin
      .from("lead_contatos")
      .select("id, feito_em, canal, resumo, proximo_em, concluido")
      .eq("lead_id", leadId)
      .order("feito_em", { ascending: false })
      .limit(10),
    admin
      .from("meetings")
      .select("id, starts_at, status, titulo, resumo, transcricao")
      .eq("lead_id", leadId)
      .order("starts_at", { ascending: false })
      .limit(8),
    admin
      .from("lead_arquivos")
      .select("id, tipo, nome, versao, atual, valor, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
  ]);

  const msgsCloser = (closer.data ?? []).reverse();
  const msgsSdr = (sdr.data ?? []).reverse();
  const listaContatos = contatos.data ?? [];
  const listaReunioes = reunioes.data ?? [];
  const listaArquivos = arquivos.data ?? [];

  // Ultima reuniao que ja aconteceu (nao cancelada/furada): dela vem a
  // transcricao.
  const agora = Date.now();
  const ultimaFeita =
    listaReunioes.find(
      (r) => new Date(r.starts_at as string).getTime() < agora && r.status !== "cancelada" && r.status !== "furada"
    ) ?? null;

  const chave = createHash("sha1")
    .update(
      JSON.stringify([
        lead.estagio,
        lead.proximo_contato,
        (lead.anotacoes as string | null)?.length ?? 0,
        msgsCloser.length,
        msgsCloser.at(-1)?.id,
        msgsSdr.at(-1)?.id,
        listaContatos[0]?.id,
        listaReunioes.map((r) => `${r.id}:${r.status}:${r.transcricao ?? ""}`),
        listaArquivos.map((a) => a.id),
      ])
    )
    .digest("hex");

  const linhas: string[] = [];
  const estagio = lead.estagio as LeadStage;
  linhas.push(`# Lead: ${lead.nome}`);
  linhas.push(`Estágio no funil: ${STAGE_LABELS[estagio] ?? estagio}${lead.estagio_em ? ` (desde ${quando(lead.estagio_em as string)})` : ""}`);
  if (lead.proximo_contato) linhas.push(`Retorno marcado hoje no CRM: ${lead.proximo_contato}`);
  if (lead.valor_fechado) linhas.push(`Valor fechado: R$ ${lead.valor_fechado}`);
  if (lead.necessidade) linhas.push(`Necessidade (do SDR): ${String(lead.necessidade).slice(0, 800)}`);
  if (lead.anotacoes) linhas.push(`\n## Anotações do closer\n${String(lead.anotacoes).slice(0, 4000)}`);

  if (listaArquivos.length) {
    linhas.push("\n## Documentos enviados");
    for (const a of listaArquivos) {
      linhas.push(
        `- ${a.tipo} v${a.versao}${a.atual ? " (atual)" : ""}, salvo em ${quando(a.created_at as string)}${a.valor ? `, valor R$ ${a.valor}` : ""}`
      );
    }
  }

  if (listaContatos.length) {
    linhas.push("\n## Follow-ups registrados pelo closer (mais recente primeiro)");
    for (const c of listaContatos) {
      linhas.push(
        `- ${quando(c.feito_em as string)} · ${c.canal}${c.resumo ? ` · ${String(c.resumo).slice(0, 400)}` : ""}${c.proximo_em ? ` · retorno: ${c.proximo_em}${c.concluido ? " (já substituído)" : ""}` : ""}`
      );
    }
  }

  if (listaReunioes.length) {
    linhas.push("\n## Reuniões (mais recente primeiro)");
    for (const r of listaReunioes) {
      linhas.push(`- ${quando(r.starts_at as string)} · ${r.status}${r.titulo ? ` · ${r.titulo}` : ""}${r.resumo ? ` · resumo: ${String(r.resumo).slice(0, 600)}` : ""}`);
    }
  }

  const fala = (dir: string, quem: [string, string]) => (dir === "outbound" ? quem[0] : quem[1]);
  if (msgsCloser.length) {
    linhas.push("\n## WhatsApp do closer (Brenno), mais antiga primeiro");
    for (const m of msgsCloser) {
      const corpo = m.body ? String(m.body).slice(0, 1200) : m.media_type ? `[${m.media_type}]` : "";
      if (corpo) linhas.push(`[${quando(m.sent_at as string)}] ${fala(m.direction as string, ["Brenno", "Cliente"])}: ${corpo}`);
    }
  } else {
    linhas.push("\n## WhatsApp do closer\n(nenhuma mensagem registrada)");
  }

  if (msgsSdr.length) {
    linhas.push("\n## WhatsApp do SDR (Ronaldo e o bot), últimas mensagens, mais antiga primeiro");
    for (const m of msgsSdr) {
      const corpo = m.body ? String(m.body).slice(0, 600) : m.media_type ? `[${m.media_type}]` : "";
      const bot = (m.raw as { bot?: boolean } | null)?.bot;
      if (corpo) linhas.push(`[${quando(m.created_at as string)}] ${m.direction === "outbound" ? (bot ? "Bot" : "SDR") : "Cliente"}: ${corpo}`);
    }
  }

  return {
    chave,
    texto: linhas.join("\n"),
    reuniaoParaTranscricao: ultimaFeita
      ? { id: ultimaFeita.id as string, transcricao: (ultimaFeita.transcricao as string | null) ?? null, starts_at: ultimaFeita.starts_at as string }
      : null,
    nome: String(lead.nome ?? ""),
  };
}

export async function gerarProximoPasso(ctx: Contexto): Promise<{ sugestao?: ProximoPasso; error?: string }> {
  let transcricao: string | null = null;
  if (ctx.reuniaoParaTranscricao) {
    const token = await getTeamAccessToken();
    transcricao = await textoDaTranscricao(token, ctx.reuniaoParaTranscricao, ctx.nome);
  }

  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: FUSO,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const partes = [
    `Agora é ${agora} (horário de Brasília). Hoje em AAAA-MM-DD: ${hojeISO()}.`,
    ctx.texto,
    transcricao
      ? `\n## Transcrição da última reunião (${quando(ctx.reuniaoParaTranscricao!.starts_at)})\n${transcricao}`
      : ctx.reuniaoParaTranscricao
        ? "\n## Transcrição da última reunião\n(não encontrada no Drive)"
        : "",
    "\nOrganize o próximo passo deste lead.",
  ];

  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: MODELO,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
      // Se o modelo recusar, a API refaz no modelo de reserva.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SISTEMA,
      messages: [{ role: "user", content: partes.join("\n") }],
    });
    const resposta = await stream.finalMessage();
    if (resposta.stop_reason === "refusal" || resposta.stop_reason === "max_tokens") {
      return { error: "A IA não conseguiu analisar este lead agora." };
    }
    const texto = resposta.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const sugestao = JSON.parse(texto) as ProximoPasso;
    if (sugestao.followup && sugestao.followup.data < hojeISO()) sugestao.followup.data = hojeISO();
    sugestao.transcricao_de = transcricao ? ctx.reuniaoParaTranscricao!.id : null;
    return { sugestao };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { error: "Limite de uso da IA atingido. Tente em alguns minutos." };
    if (e instanceof Anthropic.APIError) {
      console.error(`[proximoPasso] API ${e.status}`, e.message);
      return { error: "Falha ao consultar a IA." };
    }
    if (e instanceof SyntaxError) {
      console.error("[proximoPasso] resposta fora do formato", e.message);
      return { error: "A IA respondeu fora do formato. Tente de novo." };
    }
    console.error("[proximoPasso]", e);
    return { error: "Falha ao consultar a IA." };
  }
}

export type Guardado = { chave: string; sugestao: ProximoPasso; gerado_em: string; auto_followup_em: string | null };

export async function lerGuardado(admin: SupabaseClient, leadId: string): Promise<Guardado | null> {
  const { data, error } = await admin
    .from("lead_ia")
    .select("chave, sugestao, gerado_em, auto_followup_em")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) return null; // sem a migration 0023 segue sem cache
  return (data as Guardado | null) ?? null;
}

export async function guardar(admin: SupabaseClient, leadId: string, chave: string, sugestao: ProximoPasso) {
  const { error } = await admin
    .from("lead_ia")
    .upsert({ lead_id: leadId, chave, sugestao, gerado_em: new Date().toISOString() }, { onConflict: "lead_id" });
  if (error) console.error("[proximoPasso] guardar", error.message);
}

// So le a ultima analise guardada, sem chamar a IA. "novidade" diz se
// chegou coisa nova (mensagem, reuniao, follow-up...) depois dela.
export async function ultimaAnaliseDoLead(
  admin: SupabaseClient,
  leadId: string
): Promise<{ sugestao?: ProximoPasso; gerado_em?: string; novidade?: boolean }> {
  const salvo = await lerGuardado(admin, leadId);
  if (!salvo) return {};
  const ctx = await montarContexto(admin, leadId);
  return { sugestao: salvo.sugestao, gerado_em: salvo.gerado_em, novidade: Boolean(ctx && ctx.chave !== salvo.chave) };
}

// Analise atual do lead: a guardada, se nada mudou e e de hoje; senao gera.
export async function proximoPassoDoLead(
  admin: SupabaseClient,
  leadId: string,
  forcar = false
): Promise<{ sugestao?: ProximoPasso; gerado_em?: string; error?: string }> {
  const ctx = await montarContexto(admin, leadId);
  if (!ctx) return { error: "Lead não encontrado." };

  const salvo = await lerGuardado(admin, leadId);
  const deHoje = salvo && new Date(salvo.gerado_em).toLocaleDateString("en-CA", { timeZone: FUSO }) === hojeISO();
  if (!forcar && salvo && salvo.chave === ctx.chave && deHoje) {
    return { sugestao: salvo.sugestao, gerado_em: salvo.gerado_em };
  }

  const r = await gerarProximoPasso(ctx);
  if (!r.sugestao) {
    // Falhou agora: mostra a ultima analise, se houver.
    return salvo ? { sugestao: salvo.sugestao, gerado_em: salvo.gerado_em, error: r.error } : { error: r.error };
  }
  await guardar(admin, leadId, ctx.chave, r.sugestao);
  return { sugestao: r.sugestao, gerado_em: new Date().toISOString() };
}
