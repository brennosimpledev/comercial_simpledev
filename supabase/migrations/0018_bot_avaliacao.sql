-- =====================================================================
-- Migration 0018: avaliacao do bot gravada no lead
-- =====================================================================
--
-- O bot qualifica (ideia, prazo e orcamento) e, quando tem certeza, marca
-- a reuniao. Quando fica em duvida, nao agenda e sinaliza que o SDR deve
-- qualificar. Esse codigo vira a etiqueta do lead na lista do CRM.
--   agendado | qualificado | nao_qualificado | sdr

alter table public.leads
  add column if not exists bot_avaliacao text;

create index if not exists leads_bot_avaliacao_idx
  on public.leads (bot_avaliacao);
