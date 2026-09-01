-- =====================================================================
-- Migration 0011: diagnostico de processamento do Data Manager
-- =====================================================================
--
-- O events:ingest responde 200 e so aceita a requisicao; o casamento com
-- os cliques acontece depois, de forma assincrona. Um envio pode ficar
-- "enviado" aqui e ser 100% rejeitado la. O unico jeito de saber e guardar
-- o requestId da resposta e consultar requestStatus:retrieve depois.

alter table public.ads_conversions
  add column if not exists request_id text;

-- Resultado do processamento: SUCCESS | PARTIAL_SUCCESS | FAILED |
-- PROCESSING, seguido dos motivos quando ha erro.
alter table public.ads_conversions
  add column if not exists diagnostico text;

alter table public.ads_conversions
  add column if not exists diagnostico_at timestamptz;

-- A rota de diagnostico varre por aqui: enviados que ainda nao foram
-- conferidos.
create index if not exists ads_conversions_diagnostico_idx
  on public.ads_conversions (status, diagnostico_at)
  where request_id is not null;
