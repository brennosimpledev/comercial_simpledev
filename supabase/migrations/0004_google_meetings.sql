-- =====================================================================
-- Migration 0004: contas Google (OAuth) + reunioes (Google Meet)
-- =====================================================================

-- Tokens do Google por usuario da equipe.
create table public.google_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text,
  refresh_token text not null,
  access_token  text,
  token_expiry  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_accounts enable row level security;

-- Cada usuario so acessa a propria conexao.
create policy "propria conta google"
  on public.google_accounts for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger google_accounts_set_updated_at
  before update on public.google_accounts
  for each row execute function public.set_updated_at();

-- Reunioes agendadas de um lead.
create table public.meetings (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  titulo          text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  google_event_id text,
  meet_link       text,
  html_link       text,
  status          text not null default 'agendada'  -- agendada | cancelada | realizada
);

create index meetings_lead_idx on public.meetings (lead_id, starts_at);

alter table public.meetings enable row level security;

create policy "equipe le meetings"      on public.meetings for select to authenticated using (true);
create policy "equipe insere meetings"  on public.meetings for insert to authenticated with check (true);
create policy "equipe atualiza meetings" on public.meetings for update to authenticated using (true) with check (true);
create policy "equipe deleta meetings"  on public.meetings for delete to authenticated using (true);
