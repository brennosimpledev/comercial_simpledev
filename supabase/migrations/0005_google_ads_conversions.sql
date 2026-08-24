-- =====================================================================
-- Migration 0005: envio de conversoes offline para o Google Ads
-- =====================================================================

-- Colunas de resumo/transcricao das reunioes (aplicadas manualmente antes;
-- ficam aqui para o schema estar completo em um banco novo).
alter table public.meetings add column if not exists resumo text;
alter table public.meetings add column if not exists transcricao text;

-- Valor real do contrato fechado. O campo `orcamento` e texto livre vindo
-- do formulario, entao nao serve como valor de conversao.
alter table public.leads add column if not exists valor_fechado numeric(12,2);

-- Registro do que ja foi enviado ao Google Ads.
-- A unique (lead_id, tipo) e o que impede envio duplicado: o Google soma
-- cada upload, entao reenviar a mesma conversao infla a campanha.
create table if not exists public.ads_conversions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  tipo          text not null,               -- qualificado | fechado
  gclid         text,
  valor         numeric(12,2),
  moeda         text not null default 'BRL',
  conversion_at timestamptz not null,
  status        text not null default 'pendente',  -- pendente | enviado | erro | sem_gclid
  erro          text,
  uploaded_at   timestamptz,
  unique (lead_id, tipo)
);

create index if not exists ads_conversions_status_idx
  on public.ads_conversions (status, created_at);

alter table public.ads_conversions enable row level security;

create policy "equipe le ads_conversions"
  on public.ads_conversions for select to authenticated using (true);
create policy "equipe insere ads_conversions"
  on public.ads_conversions for insert to authenticated with check (true);
create policy "equipe atualiza ads_conversions"
  on public.ads_conversions for update to authenticated using (true) with check (true);
