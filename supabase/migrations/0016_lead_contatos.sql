-- =====================================================================
-- Migration 0016: registro de follow-up com data de retorno
-- =====================================================================
--
-- Diferente de follow_ups (a regua automatica que o bot dispara), aqui e
-- o diario do closer: o que foi conversado e quando voltar a falar. Nada
-- sai sozinho a partir desta tabela.
--
-- leads.proximo_contato guarda a data do proximo retorno em aberto, para
-- o funil ordenar e marcar os cards sem precisar varrer o historico.

create table if not exists public.lead_contatos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  lead_id     uuid not null references public.leads(id) on delete cascade,

  feito_em    timestamptz not null default now(),
  canal       text not null default 'whatsapp',  -- whatsapp | ligacao | email | reuniao
  resumo      text,
  proximo_em  date,
  concluido   boolean not null default false,
  created_by  uuid references auth.users(id)
);

create index if not exists lead_contatos_lead_idx
  on public.lead_contatos (lead_id, feito_em desc);

create index if not exists lead_contatos_retorno_idx
  on public.lead_contatos (proximo_em)
  where concluido = false and proximo_em is not null;

alter table public.leads
  add column if not exists proximo_contato date;

create index if not exists leads_proximo_contato_idx
  on public.leads (proximo_contato);

alter table public.lead_contatos enable row level security;

create policy "equipe le contatos"
  on public.lead_contatos for select to authenticated using (true);

create policy "equipe insere contatos"
  on public.lead_contatos for insert to authenticated with check (true);

create policy "equipe atualiza contatos"
  on public.lead_contatos for update to authenticated using (true) with check (true);

create policy "equipe deleta contatos"
  on public.lead_contatos for delete to authenticated using (true);
