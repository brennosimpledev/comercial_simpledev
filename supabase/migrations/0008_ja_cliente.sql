-- =====================================================================
-- Migration 0008: marca leads que ja sao clientes
-- =====================================================================

-- O numero do SDR tambem atende cobranca, entao cliente existente entra no
-- funil como lead novo. Marcar permite tira-lo das metricas sem apagar a
-- conversa, que continua sendo historico util do relacionamento.
alter table public.leads
  add column if not exists ja_cliente boolean not null default false;

create index if not exists leads_ja_cliente_idx
  on public.leads (ja_cliente)
  where ja_cliente = true;
