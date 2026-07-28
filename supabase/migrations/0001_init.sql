-- =====================================================================
-- SimpleDEV Comercial (CRM) - Fase 1
-- Migration inicial: enums, tabela leads, trigger updated_at, RLS, indices
-- =====================================================================

-- ---------- Enums ----------
create type lead_stage as enum (
  'novo',
  'sdr',
  'reuniao_marcada',
  'proposta',
  'fechado',
  'perdido'
);

create type lead_origin as enum (
  'google_ads',
  'meta_ads',
  'indicacao',
  'organico',
  'outro'
);

create type lead_status as enum (
  'ativo',
  'ganho',
  'perdido'
);

-- ---------- Tabela leads ----------
create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Contato
  nome          text not null,
  email         text,
  whatsapp      text,

  -- Qualificacao
  origem        lead_origin not null default 'outro',
  orcamento     text,
  necessidade   text,
  prazo         text,            -- "inicio" da LP: quando quer comecar
  relacao_projeto text,

  -- Pipeline
  estagio       lead_stage  not null default 'novo',
  status        lead_status not null default 'ativo',
  anotacoes     text,

  -- Rastreamento / UTMs
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  gclid         text,
  referral_source text,

  -- Metadados da conversao
  dispositivo   text,
  url_conversao text,
  ip_usuario    inet,
  pais          text,
  regiao        text,
  cidade        text,
  data_conversao timestamptz,
  form_id       text,
  page_id       text,

  -- Auditoria
  raw_payload   jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  assigned_to   uuid references auth.users(id) on delete set null
);

comment on table public.leads is 'Leads do funil comercial da SimpleDEV (Fase 1).';

-- ---------- Indices ----------
create index leads_estagio_idx    on public.leads (estagio);
create index leads_status_idx     on public.leads (status);
create index leads_origem_idx     on public.leads (origem);
create index leads_email_idx      on public.leads (email);
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_assigned_idx   on public.leads (assigned_to);

-- ---------- Trigger updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

-- ---------- Row Level Security ----------
-- Toda a area interna eh so para a equipe (usuarios autenticados).
-- O webhook usa a SERVICE ROLE KEY, que ignora RLS por padrao.
alter table public.leads enable row level security;

create policy "equipe le leads"
  on public.leads for select
  to authenticated
  using (true);

create policy "equipe insere leads"
  on public.leads for insert
  to authenticated
  with check (true);

create policy "equipe atualiza leads"
  on public.leads for update
  to authenticated
  using (true)
  with check (true);

create policy "equipe deleta leads"
  on public.leads for delete
  to authenticated
  using (true);
