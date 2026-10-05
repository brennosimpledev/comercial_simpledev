-- =====================================================================
-- Migration 0015: funil do closer separado do funil do SDR
-- =====================================================================
--
-- O SDR trabalha volume (novo -> sdr -> reuniao marcada -> descartado).
-- O closer so ve quem ja sentou na reuniao, e dali segue ate fechar.
-- Os dois quadros leem o mesmo campo "estagio": cada lead esta sempre em
-- um lugar so, e a passagem de um quadro para o outro e um evento com
-- data (estagio_em), que e o que permite medir dias parado.

alter type lead_stage add value if not exists 'reuniao_feita';
alter type lead_stage add value if not exists 'escopo_enviado';
alter type lead_stage add value if not exists 'apresentacao_marcada';
alter type lead_stage add value if not exists 'negociacao';
alter type lead_stage add value if not exists 'descartado';

alter table public.leads
  add column if not exists estagio_em timestamptz not null default now();

create index if not exists leads_estagio_em_idx on public.leads (estagio_em desc);
