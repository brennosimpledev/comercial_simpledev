-- =====================================================================
-- Migration 0012: identificadores de clique do iOS
-- =====================================================================
--
-- Desde o iOS 14.5 o auto-tagging do Google Ads nao manda gclid em parte
-- do trafego: manda gbraid (clique que vem de app) ou wbraid (clique web
-- no iOS quando o IDFA nao pode ser lido). Capturando so gclid, esse
-- pedaco do trafego chega sem identificador e a conversao nunca sobe -
-- e o motivo de a maioria das linhas de ads_conversions estar em
-- "sem_gclid".
--
-- O adIdentifiers da Data Manager API aceita os tres campos.

alter table public.leads add column if not exists gbraid text;
alter table public.leads add column if not exists wbraid text;

-- Qual dos tres identificadores foi usado no envio. Necessario para o
-- reenvio saber em que campo do adIdentifiers colocar o valor: a coluna
-- `gclid` desta tabela e generica e ja guarda tambem ids da Meta.
alter table public.ads_conversions add column if not exists id_tipo text;

create index if not exists leads_gbraid_idx on public.leads (gbraid)
  where gbraid is not null;
create index if not exists leads_wbraid_idx on public.leads (wbraid)
  where wbraid is not null;
