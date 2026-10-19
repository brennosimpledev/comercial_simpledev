// Transforma audio e imagem do WhatsApp em texto. SERVER-ONLY.
//
// Audio: transcricao pela OpenAI (a API do Claude nao recebe audio).
// Imagem: descricao curta pelo Claude, que le imagem.
//
// O texto resultante vira o corpo da mensagem no CRM. Serve ao bot, que
// passa a responder ao conteudo, e serve ao time, que le o audio em vez
// de ouvir e entende a foto sem abrir.

import Anthropic from "@anthropic-ai/sdk";
import { getMediaBase64 } from "@/lib/evolution/client";

const MODELO_TRANSCRICAO = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
const MODELO_VISAO = process.env.MIDIA_MODELO_VISAO ?? "claude-opus-5-5";

// O Claude aceita estes formatos de imagem.
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type TipoImagem = (typeof TIPOS_IMAGEM)[number];

export function transcricaoAtiva() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function visaoAtiva() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type Payload = { message?: Record<string, unknown> | null } & Record<string, unknown>;

// Com webhookBase64 ligado, a Evolution ja manda o arquivo junto; senao,
// busca pela API.
async function baixar(raw: Payload): Promise<{ base64: string; mimetype: string } | null> {
  const msg = (raw.message ?? {}) as Record<string, unknown>;
  const embutido = typeof msg.base64 === "string" ? (msg.base64 as string) : null;
  const tipoAudio = (msg.audioMessage as { mimetype?: string } | undefined)?.mimetype;
  const tipoImagem = (msg.imageMessage as { mimetype?: string } | undefined)?.mimetype;
  if (embutido) {
    return { base64: embutido, mimetype: tipoAudio ?? tipoImagem ?? "application/octet-stream" };
  }
  return getMediaBase64(raw);
}

export async function transcreverAudio(raw: Payload): Promise<string | null> {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return null;

  const midia = await baixar(raw);
  if (!midia) return null;

  // Nota de voz do WhatsApp chega como ogg/opus, formato que a OpenAI aceita.
  const tipo = midia.mimetype.split(";")[0].trim() || "audio/ogg";
  const extensao = tipo.includes("mpeg") ? "mp3" : tipo.includes("mp4") ? "m4a" : "ogg";

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(Buffer.from(midia.base64, "base64"))], { type: tipo }),
    `audio.${extensao}`
  );
  form.append("model", MODELO_TRANSCRICAO);
  form.append("language", "pt");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error("[midia] transcricao HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim() || null;
  } catch (e) {
    console.error("[midia] transcricao falhou:", e);
    return null;
  }
}

const PEDIDO_DESCRICAO = `Esta imagem foi enviada por um possível cliente no WhatsApp de uma empresa de desenvolvimento de software sob medida.

Descreva em português, em no máximo 3 frases curtas, o que aparece e o que isso diz sobre o negócio ou o projeto dele (por exemplo: tela de um sistema, planilha, foto do produto, do estabelecimento, documento, print de concorrente). Se houver texto legível importante, transcreva o essencial.

Não invente o que não dá para ver. Responda só com a descrição.`;

export async function descreverImagem(raw: Payload): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const midia = await baixar(raw);
  if (!midia) return null;

  const tipo = midia.mimetype.split(";")[0].trim() as TipoImagem;
  if (!TIPOS_IMAGEM.includes(tipo)) return null;

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODELO_VISAO,
      max_tokens: 1024,
      output_config: { effort: "low" },
      // Se o modelo recusar por politica, a API refaz no modelo de reserva.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: tipo, data: midia.base64 } },
            { type: "text", text: PEDIDO_DESCRICAO },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return null;
    const texto = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return texto || null;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      console.error("[midia] descricao: limite de uso, tente depois");
    } else if (e instanceof Anthropic.APIError) {
      console.error(`[midia] descricao: API ${e.status}`, e.message);
    } else {
      console.error("[midia] descricao falhou:", e);
    }
    return null;
  }
}

/**
 * Enriquece a mensagem recebida com o texto do audio ou a descricao da
 * imagem. Devolve o novo corpo, ou null se nao havia o que fazer.
 */
export async function entenderMidia(
  tipo: string | null,
  raw: Payload,
  legenda: string
): Promise<string | null> {
  if (tipo === "audio") {
    const texto = await transcreverAudio(raw);
    return texto ? `🎙️ ${texto}` : null;
  }
  if (tipo === "image") {
    const descricao = await descreverImagem(raw);
    if (!descricao) return null;
    return legenda ? `${legenda}\n🖼️ [imagem: ${descricao}]` : `🖼️ [imagem: ${descricao}]`;
  }
  return null;
}
