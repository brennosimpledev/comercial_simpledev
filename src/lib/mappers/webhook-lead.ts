import type { LeadOrigin } from "@/types/database";

// Payload cru que chega da LP (lp.simpledev.com.br).
export interface LpWebhookPayload {
  nome?: string;
  email?: string;
  whatsapp?: string;
  necessidade?: string;
  estagio?: string; // estagio de compra do CLIENTE, nao o do pipeline
  inicio?: string;
  orcamento?: string;
  relacao_projeto?: string;
  Referral_Source?: string;
  Dispositivo?: string;
  URL?: string;
  IP_do_usuario?: string;
  Data_da_conversao?: string;
  Id_do_formulario?: string | number;
  Pais_do_usuario?: string;
  Regiao_do_usuario?: string;
  Cidade_do_usuario?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  // iOS 14.5+ manda um destes dois no lugar do gclid.
  gbraid?: string;
  wbraid?: string;
  // ChatGPT Ads: id do clique (?oppref=) e do navegador (cookie __obref), e
  // o id do evento lead_created que o pixel disparou (para nao contar duas
  // vezes quando o CRM manda o mesmo evento pelo servidor).
  oppref?: string;
  obref?: string;
  openai_event_id?: string;
  Id_da_pagina?: string | number;
  [key: string]: unknown;
}

// Normaliza string vazia / whitespace -> null.
function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

const VALID_ORIGINS: LeadOrigin[] = [
  "google_ads",
  "meta_ads",
  "indicacao",
  "organico",
  "whatsapp",
  "workana",
  "chatgpt_ads",
  "outro",
];

// Origem explicita no payload (ex.: ferramenta de automacao mandando "meta_ads").
function explicitOrigin(payload: LpWebhookPayload): LeadOrigin | null {
  const o = clean(payload.origem as string | undefined)?.toLowerCase();
  return o && VALID_ORIGINS.includes(o as LeadOrigin)
    ? (o as LeadOrigin)
    : null;
}

// Deriva a origem do lead a partir de gclid / utm_source.
export function deriveOrigin(payload: LpWebhookPayload): LeadOrigin {
  if (clean(payload.gclid) || clean(payload.gbraid) || clean(payload.wbraid))
    return "google_ads";

  const src = (clean(payload.utm_source) ?? "").toLowerCase();
  // Antes da Meta: "chatgpt" nao pode cair em nenhuma regra abaixo.
  if (clean(payload.oppref) || src.includes("chatgpt") || src.includes("openai")) return "chatgpt_ads";
  if (!src) return "organico";

  if (src.includes("google")) return "google_ads";
  if (
    src.includes("meta") ||
    src.includes("facebook") ||
    src.includes("fb") ||
    src.includes("instagram") ||
    src.includes("ig")
  ) {
    return "meta_ads";
  }
  return "outro";
}

// Converte a data da conversao (aceita ISO ou vazio) para ISO ou null.
function parseDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Mapeia o payload da LP para as colunas da tabela `leads`.
// Observacao: `estagio` do payload NAO vira o estagio do pipeline;
// o lead sempre entra como 'novo'. O valor original fica em raw_payload.
export function mapWebhookToLead(payload: LpWebhookPayload) {
  return {
    nome: clean(payload.nome) ?? "Sem nome",
    email: clean(payload.email),
    whatsapp: clean(payload.whatsapp),

    origem: explicitOrigin(payload) ?? deriveOrigin(payload),
    orcamento: clean(payload.orcamento),
    necessidade: clean(payload.necessidade),
    prazo: clean(payload.inicio),
    relacao_projeto: clean(payload.relacao_projeto),

    estagio: "novo" as const,
    status: "ativo" as const,

    utm_source: clean(payload.utm_source),
    utm_medium: clean(payload.utm_medium),
    utm_campaign: clean(payload.utm_campaign),
    utm_term: clean(payload.utm_term),
    utm_content: clean(payload.utm_content),
    gclid: clean(payload.gclid),
    gbraid: clean(payload.gbraid),
    wbraid: clean(payload.wbraid),
    referral_source: clean(payload.Referral_Source),

    dispositivo: clean(payload.Dispositivo),
    url_conversao: clean(payload.URL),
    ip_usuario: clean(payload.IP_do_usuario),
    pais: clean(payload.Pais_do_usuario),
    regiao: clean(payload.Regiao_do_usuario),
    cidade: clean(payload.Cidade_do_usuario),
    data_conversao: parseDate(payload.Data_da_conversao),
    form_id: clean(payload.Id_do_formulario),
    page_id: clean(payload.Id_da_pagina),

    raw_payload: payload as Record<string, unknown>,
  };
}

// Campos do ChatGPT Ads, gravados a parte: sem a migration 0024 as colunas
// nao existem e o lead nao pode deixar de entrar por causa disso.
export function rastreioOpenAI(payload: LpWebhookPayload) {
  return {
    openai_oppref: clean(payload.oppref),
    openai_obref: clean(payload.obref),
    eventId: clean(payload.openai_event_id),
  };
}
