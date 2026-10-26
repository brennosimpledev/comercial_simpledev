-- =====================================================================
-- Migration 0017: bloqueios de agenda e contagem de remarcacoes
-- =====================================================================
--
-- Bloqueio: periodo em que ninguem marca reuniao (medico, viagem, outro
-- compromisso). O CRM recusa agendar ou remarcar em cima dele.
--
-- Remarcacoes: remarcar so trocava a data da mesma reuniao e o historico
-- se perdia. Agora a reuniao conta quantas vezes foi remarcada, para o
-- calendario avisar que aquele cliente ja remarcou.

create table if not exists public.agenda_bloqueios (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  inicio      timestamptz not null,
  fim         timestamptz not null,
  motivo      text,
  created_by  uuid references auth.users(id),
  constraint agenda_bloqueios_periodo check (fim > inicio)
);

create index if not exists agenda_bloqueios_periodo_idx
  on public.agenda_bloqueios (inicio, fim);

alter table public.agenda_bloqueios enable row level security;

create policy "equipe le bloqueios"
  on public.agenda_bloqueios for select to authenticated using (true);

create policy "equipe insere bloqueios"
  on public.agenda_bloqueios for insert to authenticated with check (true);

create policy "equipe deleta bloqueios"
  on public.agenda_bloqueios for delete to authenticated using (true);

alter table public.meetings
  add column if not exists remarcacoes int not null default 0;
