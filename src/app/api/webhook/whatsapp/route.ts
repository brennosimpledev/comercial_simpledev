import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brCanonical, last8 } from "@/lib/phone";
import { mediaKind, messageBody } from "@/lib/whatsapp-message";

export const runtime = "nodejs";

/**
 * Rastreio que a landing page injeta no texto do WhatsApp.
 *
 * O WhatsApp nao carrega o gclid sozinho - nao existe equivalente do
 * ctwaClid para o Google. A LP resolve escrevendo os campos na propria
 * mensagem; aqui a gente le de volta.
 */
function acharRastreioDaLp(texto: string | null): {
  daLp: boolean;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  leadgenId?: string;
} {
  if (!texto) return { daLp: false };

  // Sem regex de proposito: sao linhas 'chave: valor' escritas pela
  // propria LP, e regex com barra invertida ja quebrou o build deste
  // projeto antes.
  const achado: Record<string, string> = {};
  let daLp = false;

  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim();
    const sep = linha.indexOf(':');
    if (sep < 1) continue;
    const chave = linha.slice(0, sep).trim().toLowerCase();
    const valor = linha.slice(sep + 1).trim();

    if (chave === 'origem' && valor.toLowerCase() === 'site') daLp = true;
    // iOS 14.5+ manda gbraid ou wbraid no lugar do gclid.
    if (
      valor &&
      (chave === 'gclid' ||
        chave === 'gbraid' ||
        chave === 'wbraid' ||
        chave === 'leadgen_id')
    ) {
      achado[chave] = valor;
    }
  }

  return {
    daLp,
    gclid: achado.gclid,
    gbraid: achado.gbraid,
    wbraid: achado.wbraid,
    leadgenId: achado.leadgen_id,
  };
}

/**
 * Reconhece o repasse de um formulario instantaneo da Meta.
 *
 * A automacao que recebe o lead do formulario manda a mensagem pelo WhatsApp,
 * e ela nao carrega metadado de anuncio - so o conteudo. Sem isso o lead
 * entraria como 'whatsapp' e inflaria o organico.
 *
 * Casa pelos nomes de campo do formulario, nao pela saudacao: a saudacao e
 * texto da automacao e pode mudar sem aviso; os nomes de campo vem da Meta.
 * E heuristica - se a automacao mudar os campos, para de detectar.
 */
function pareceFormularioMeta(texto: string | null): boolean {
  if (!texto) return false;
  // A LP monta uma mensagem quase igual a do formulario da Meta. Sem esta
  // exclusao, lead do Google entraria como meta_ads.
  if (acharRastreioDaLp(texto).daLp) return false;
  const t = texto.toLowerCase();
  const marcas = ["work_email:", "full_name:", "phone_number:"];
  return marcas.filter((m) => t.includes(m)).length >= 2;
}

/**
 * Dados do anuncio Click-to-WhatsApp, quando a conversa comecou por um.
 * Busca recursiva em vez de caminho fixo: o objeto aninha diferente conforme
 * o tipo da mensagem (texto, imagem, video).
 */
function acharAnuncio(
  no: unknown,
  nivel = 0
): { ctwaClid?: string; sourceId?: string; sourceApp?: string } | null {
  if (!no || typeof no !== "object" || nivel > 8) return null;
  const obj = no as Record<string, unknown>;
  if (obj.externalAdReply && typeof obj.externalAdReply === "object") {
    const a = obj.externalAdReply as Record<string, unknown>;
    return {
      ctwaClid: typeof a.ctwaClid === "string" ? a.ctwaClid : undefined,
      sourceId: typeof a.sourceId === "string" ? a.sourceId : undefined,
      sourceApp: typeof a.sourceApp === "string" ? a.sourceApp : undefined,
    };
  }
  for (const v of Object.values(obj)) {
    const achado = acharAnuncio(v, nivel + 1);
    if (achado) return achado;
  }
  return null;
}
export const dynamic = "force-dynamic";

// Recebe eventos da Evolution API (mensagens de WhatsApp).
// Configure na Evolution o webhook apontando para:
//   POST https://SEU_DOMINIO/api/webhook/whatsapp
// Evento necessario: MESSAGES_UPSERT.

interface EvoKey {
  remoteJid?: string;
  remoteJidAlt?: string; // numero real quando remoteJid vem como @lid
  fromMe?: boolean;
  id?: string;
}
interface EvoMessage {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  [k: string]: unknown;
}
interface EvoData {
  key?: EvoKey;
  pushName?: string;
  message?: EvoMessage;
  messageType?: string;
  messageTimestamp?: number;
}

// Extrai os digitos do numero real do contato a partir da key.
// O WhatsApp novo pode mandar remoteJid como "<id>@lid" (ofuscado) e o
// numero real em remoteJidAlt. Ignora grupos/newsletters/status/broadcast.
function keyToDigits(key?: EvoKey): string | null {
  if (!key) return null;
  const candidate =
    (key.remoteJid?.endsWith("@s.whatsapp.net") && key.remoteJid) ||
    (key.remoteJidAlt?.endsWith("@s.whatsapp.net") && key.remoteJidAlt) ||
    null;
  if (!candidate) return null;
  const digits = candidate.split("@")[0]?.replace(/\D/g, "") || "";
  // Numero brasileiro/internacional plausivel (10 a 15 digitos).
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      request.headers.get("x-webhook-secret") ??
      request.nextUrl.searchParams.get("token");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: { event?: string; data?: EvoData | EvoData[] };
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = (payload.event ?? "").toLowerCase();
  // Aceita messages.upsert / messages_upsert.
  if (!event.includes("messages") || !event.includes("upsert")) {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  const supabase = createAdminClient();
  let processed = 0;

  for (const data of items) {
    if (!data) continue;
    const digits = keyToDigits(data.key);
    if (!digits) continue;

    const text = messageBody(data.message);
    const kind = mediaKind(data.message);
    const fromMe = Boolean(data.key?.fromMe);
    const waMessageId = data.key?.id ?? null;
    const pushName = data.pushName ?? null;

    // Prefiltro barato pelos ultimos 8 digitos e confirmacao pelo numero
    // canonico (DDD + 8), evitando casar numeros de DDDs diferentes.
    const canon = brCanonical(digits);
    const { data: candidates } = await supabase
      .from("leads")
      .select("id, whatsapp")
      .like("whatsapp_digits", `%${last8(digits)}`)
      .limit(10);

    let leadId = (candidates ?? []).find(
      (c) => brCanonical(c.whatsapp as string | null) === canon
    )?.id as string | undefined;

    if (!leadId) {
      // Nao cria lead para mensagens que NOS enviamos a um numero desconhecido.
      if (fromMe) continue;
      // Se a conversa veio de um anuncio, o lead nao e "whatsapp": e do
      // canal que pagou pelo clique, e o ctwa_clid permite devolver conversao.
      const rastreio = acharRastreioDaLp(text);
      // Qualquer um dos tres identificadores prova Google Ads.
      const doGoogle = Boolean(
        rastreio.gclid || rastreio.gbraid || rastreio.wbraid
      );
      const anuncio = acharAnuncio(data);
      const deAnuncio = Boolean(anuncio?.ctwaClid);
      // Sem metadado de anuncio, mas com cara de formulario repassado: a
      // origem e Meta do mesmo jeito, so nao da para atribuir o clique.
      const deFormulario =
        !deAnuncio && (Boolean(rastreio.leadgenId) || pareceFormularioMeta(text));
      const daMeta = deAnuncio || deFormulario;

      const { data: created } = await supabase
        .from("leads")
        .insert({
          nome: pushName || `WhatsApp ${digits.slice(-4)}`,
          whatsapp: digits,
          // gclid na mensagem prova Google Ads e tem prioridade sobre o
          // resto: e o unico sinal deterministico deste caminho.
          origem: doGoogle
            ? "google_ads"
            : daMeta
              ? "meta_ads"
              : rastreio.daLp
                ? "organico"
                : "whatsapp",
          gclid: rastreio.gclid ?? null,
          gbraid: rastreio.gbraid ?? null,
          wbraid: rastreio.wbraid ?? null,
          ctwa_clid: anuncio?.ctwaClid ?? null,
          meta_ad_id: anuncio?.sourceId ?? null,
          // Quando a automacao repassa o formulario instantaneo incluindo
          // o leadgen_id, o lead deixa de ser so classificado e passa a ser
          // atribuivel: da para devolver a conversao para a Meta.
          meta_lead_id: rastreio.leadgenId ?? null,
          utm_source: doGoogle
            ? "google"
            : daMeta
              ? anuncio?.sourceApp ?? "meta"
              : null,
          utm_medium: doGoogle || daMeta ? "paid" : null,
          estagio: "novo",
          status: "ativo",
        })
        .select("id")
        .single();
      leadId = created?.id;
    }

    if (!leadId) continue;

    // Evita duplicar a mesma mensagem (unique em wa_message_id).
    const { error: insErr } = await supabase.from("lead_messages").insert({
      lead_id: leadId,
      direction: fromMe ? "outbound" : "inbound",
      body: text,
      media_type: kind,
      wa_message_id: waMessageId,
      status: fromMe ? "sent" : "received",
      raw: data as unknown as Record<string, unknown>,
    });

    // Se foi o CLIENTE que respondeu: marca que respondeu e para a regua.
    if (!fromMe && !insErr) {
      await supabase
        .from("leads")
        .update({ sem_resposta: false })
        .eq("id", leadId);
      await supabase
        .from("follow_ups")
        .update({ status: "cancelado" })
        .eq("lead_id", leadId)
        .eq("status", "pendente");
    }

    processed++;
  }

  return NextResponse.json({ ok: true, processed });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "webhook/whatsapp",
    version: "tz-hydration-fix",
  });
}
