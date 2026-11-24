// API de conversoes dos anuncios do ChatGPT (OpenAI). SERVER-ONLY.
// Docs: https://developers.openai.com/ads/conversions-api
//
// Mesmo papel da API de conversoes da Meta: o CRM avisa a OpenAI quando um
// lead entra, vira qualificado, marca reuniao, fecha etc.
//
// Vai TODO lead, nao so o que chegou com clique do ChatGPT: a OpenAI
// recomenda mandar todos os eventos ("not just those with an oppref") para
// casar quem viu o anuncio e converteu por outro caminho. A atribuicao usa
// o oppref (id do clique) e o obref (id do navegador), capturados pela LP,
// mais e-mail, telefone e nome com hash SHA-256, e IP e navegador quando o
// lead entra pelo site. Consequencia: o painel da OpenAI passa a contar
// conversao "por visualizacao" que veio de outra midia. Para julgar o canal,
// use a origem do lead no CRM, nao o numero da OpenAI.
//
// Envs: OPENAI_ADS_PIXEL_ID (o mesmo id do pixel da LP) e
// OPENAI_ADS_CAPI_KEY (chave da API de conversoes, aba Conversoes do Ads
// Manager — diferente da chave da API de anuncios).

import { createHash } from "node:crypto";

const PIXEL_ID = process.env.OPENAI_ADS_PIXEL_ID;
const CHAVE = process.env.OPENAI_ADS_CAPI_KEY;
const ENDPOINT = "https://bzr.openai.com/v1/events";
const LP = "https://lp.simpledev.com.br/";

export function openaiConfigurado() {
  return Boolean(PIXEL_ID && CHAVE);
}

// Tipos do CRM -> evento na OpenAI. Os padronizados existem na plataforma;
// o resto vai como evento personalizado, com o nome do CRM.
type TipoCrm =
  | "lead"
  | "qualificado"
  | "desqualificado"
  | "fechado"
  | "reuniao_marcada"
  | "reuniao_realizada"
  | "escopo_enviado"
  | "apresentacao_marcada"
  | "negociacao"
  | "interesse";

const PADRAO: Partial<Record<TipoCrm, { type: string; dados: string }>> = {
  lead: { type: "lead_created", dados: "customer_action" },
  reuniao_marcada: { type: "appointment_scheduled", dados: "customer_action" },
  fechado: { type: "order_created", dados: "contents" },
};

const PERSONALIZADO: Partial<Record<TipoCrm, string>> = {
  qualificado: "lead_qualificado",
  desqualificado: "lead_desqualificado",
  reuniao_realizada: "reuniao_realizada",
  escopo_enviado: "escopo_enviado",
  apresentacao_marcada: "apresentacao_marcada",
  negociacao: "negociacao",
  interesse: "interesse_fechamento",
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function emailHash(email: string | null | undefined) {
  const e = (email ?? "").trim().toLowerCase();
  return e.includes("@") ? sha(e) : null;
}

// Telefone: so digitos, com DDI, sem zeros a esquerda, 8 a 15 digitos.
// Numero gravado com "+" ja traz o DDI: um americano (+1 415 555 0132) tem
// 11 digitos e nao pode ganhar o 55. A LP aplica a mesma regra no pixel.
function telefoneHash(tel: string | null | undefined) {
  const temDdi = /^\s*\+/.test(tel ?? "");
  let d = (tel ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!temDdi && (d.length === 10 || d.length === 11)) d = "55" + d;
  return d.length >= 8 && d.length <= 15 ? sha(d) : null;
}

// Nome: minusculo, sem espaco e sem pontuacao ASCII, acento mantido
// ("O'Connor" -> "oconnor", "José" -> "josé"). A LP aplica a mesma regra no
// pixel; se mudar aqui, muda la.
function nomeNormalizado(parte: string) {
  return parte.normalize("NFC").toLowerCase().replace(/[\s!-/:-@[-`{-~]/g, "");
}

function nomesHash(nome: string | null | undefined) {
  const partes = (nome ?? "").trim().split(/\s+/).map(nomeNormalizado).filter(Boolean);
  if (partes.length === 0) return {};
  return {
    first_names_sha256: [sha(partes[0])],
    ...(partes.length > 1 ? { last_names_sha256: [sha(partes[partes.length - 1])] } : {}),
  };
}

export async function enviarEventoOpenAI(opts: {
  tipo: TipoCrm;
  eventId: string;
  quando: Date;
  oppref?: string | null;
  obref?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  nome?: string | null;
  leadId: string;
  valor?: number;
  // Entrada pelo site: o evento e "web", com a URL. Lead da Meta ou do
  // WhatsApp nunca passou pela pagina e vai como "other".
  doSite?: boolean;
  // IP e navegador de quem preencheu, so na entrada pelo site (o webhook
  // recebe a requisicao direto do navegador da pessoa).
  ip?: string | null;
  userAgent?: string | null;
  // Teste: a OpenAI valida o evento e nao grava nada.
  soValidar?: boolean;
}): Promise<{ ok: boolean; error?: string; status?: number }> {
  if (!openaiConfigurado()) return { ok: false, error: "OpenAI Ads não configurado." };
  const padrao = PADRAO[opts.tipo];
  const personalizado = PERSONALIZADO[opts.tipo];
  if (!padrao && !personalizado) return { ok: false, error: `Tipo sem evento na OpenAI: ${opts.tipo}` };

  const emails = [emailHash(opts.email)].filter(Boolean) as string[];
  const telefones = [telefoneHash(opts.whatsapp)].filter(Boolean) as string[];
  const user: Record<string, unknown> = { external_ids_sha256: [sha(opts.leadId)] };
  if (emails.length) user.emails_sha256 = emails;
  if (telefones.length) user.phone_numbers_sha256 = telefones;
  Object.assign(user, nomesHash(opts.nome));
  if (opts.obref) user.obref = opts.obref;
  if (opts.ip) user.ip_address = opts.ip;
  if (opts.userAgent) user.user_agent = opts.userAgent;

  // Valor em centavos (a API usa a menor unidade da moeda).
  const centavos = opts.valor && opts.valor > 0 ? Math.round(opts.valor * 100) : 0;
  let data: Record<string, unknown>;
  if (padrao?.dados === "contents") {
    data = {
      type: "contents",
      ...(centavos ? { amount: centavos, currency: "BRL" } : {}),
      contents: [{ id: "projeto", name: "Projeto SimpleDev", quantity: 1, ...(centavos ? { amount: centavos, currency: "BRL" } : {}) }],
    };
  } else if (padrao) {
    data = { type: "customer_action" };
  } else {
    data = { type: "custom" };
  }

  const evento: Record<string, unknown> = {
    id: opts.eventId,
    type: padrao ? padrao.type : "custom",
    ...(personalizado && !padrao ? { custom_event_name: personalizado } : {}),
    timestamp_ms: opts.quando.getTime(),
    // Lead do site nasce na pagina; o resto (lead de outra entrada e as
    // etapas do funil) acontece fora dela.
    action_source: opts.tipo === "lead" && opts.doSite ? "web" : "other",
    ...(opts.tipo === "lead" && opts.doSite ? { source_url: LP } : {}),
    ...(opts.oppref ? { oppref: opts.oppref } : {}),
    user,
    data,
  };

  try {
    const res = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(PIXEL_ID!)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(opts.soValidar ? { validate_only: true } : {}),
        integration_source: "simpledev-crm",
        events: [evento],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const texto = (await res.text().catch(() => "")).slice(0, 600);
      return { ok: false, status: res.status, error: `${res.status} ${texto}` };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 400) };
  }
}
