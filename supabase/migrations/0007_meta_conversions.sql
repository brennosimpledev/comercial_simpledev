-- =====================================================================
-- Migration 0007: conversoes offline tambem para a Meta
-- =====================================================================

-- Identificador do lead do lado da Meta (leadgen_id, 15-17 digitos). E o
-- equivalente do gclid: e por ele que a Meta liga a conversao ao anuncio.
alter table public.leads add column if not exists meta_lead_id text;

-- Backfill do que o webhook ja guardou dentro do payload bruto.
update public.leads
   set meta_lead_id = raw_payload -> 'leadgen' ->> 'leadgen_id'
 where meta_lead_id is null
   and raw_payload -> 'leadgen' ->> 'leadgen_id' is not null;

create index if not exists leads_meta_lead_id_idx
  on public.leads (meta_lead_id)
  where meta_lead_id is not null;

-- A mesma tabela passa a servir os dois canais. Sem isso, um lead so poderia
-- ter uma conversao por tipo no total, e nao uma por canal.
alter table public.ads_conversions
  add column if not exists canal text not null default 'google';

-- A unique antiga era (lead_id, tipo); precisa incluir o canal.
alter table public.ads_conversions
  drop constraint if exists ads_conversions_lead_id_tipo_key;

create unique index if not exists ads_conversions_lead_tipo_canal_key
  on public.ads_conversions (lead_id, tipo, canal);
