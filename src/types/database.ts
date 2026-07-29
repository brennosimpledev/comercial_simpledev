// Tipos manuais da Fase 1 (podem ser substituidos por tipos gerados
// via `supabase gen types typescript` quando o CLI estiver configurado).

export type LeadStage =
  | "novo"
  | "sdr"
  | "reuniao_marcada"
  | "proposta"
  | "fechado"
  | "perdido";

export type LeadOrigin =
  | "google_ads"
  | "meta_ads"
  | "indicacao"
  | "organico"
  | "whatsapp"
  | "workana"
  | "outro";

export type LeadStatus = "ativo" | "ganho" | "perdido";

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;

  nome: string;
  email: string | null;
  whatsapp: string | null;

  origem: LeadOrigin;
  orcamento: string | null;
  necessidade: string | null;
  prazo: string | null;
  relacao_projeto: string | null;

  estagio: LeadStage;
  status: LeadStatus;
  anotacoes: string | null;
  descricao: string | null;

  qualificado: boolean;
  sem_resposta: boolean;
  desqualificado: boolean;
  bot_pausado: boolean;
  whatsapp_digits: string | null;

  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  referral_source: string | null;

  dispositivo: string | null;
  url_conversao: string | null;
  ip_usuario: string | null;
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
  data_conversao: string | null;
  form_id: string | null;
  page_id: string | null;

  raw_payload: Record<string, unknown> | null;
  created_by: string | null;
  assigned_to: string | null;
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  novo: "Novo",
  sdr: "SDR",
  reuniao_marcada: "Reunião Marcada",
  proposta: "Proposta",
  fechado: "Fechado",
  perdido: "Perdido",
};

export const STAGE_ORDER: LeadStage[] = [
  "novo",
  "sdr",
  "reuniao_marcada",
  "proposta",
  "fechado",
  "perdido",
];

export const ORIGIN_LABELS: Record<LeadOrigin, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  indicacao: "Indicação",
  organico: "Orgânico",
  whatsapp: "WhatsApp",
  workana: "Workana",
  outro: "Outro",
};

export type MessageDirection = "inbound" | "outbound";

export interface LeadMessage {
  id: string;
  created_at: string;
  lead_id: string;
  direction: MessageDirection;
  body: string | null;
  media_url: string | null;
  media_type: string | null;
  wa_message_id: string | null;
  status: string | null;
  sent_by: string | null;
}

export type FollowUpStatus = "pendente" | "enviado" | "cancelado" | "pulado";

export interface FollowUp {
  id: string;
  created_at: string;
  lead_id: string;
  template_key: string;
  titulo: string | null;
  body: string;
  scheduled_at: string;
  sent_at: string | null;
  status: FollowUpStatus;
  canal: string;
}
