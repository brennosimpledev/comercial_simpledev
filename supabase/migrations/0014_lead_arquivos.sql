-- =====================================================================
-- Migration 0014: escopos e propostas versionados por lead
-- =====================================================================
--
-- O cliente pede ajuste no escopo, o closer sobe outra versao, e a
-- negociacao segue em cima de UMA delas. Sem versionamento ninguem sabe
-- qual papel esta valendo hoje. Cada arquivo guarda a sua versao e a
-- flag "atual"; o indice parcial garante um unico atual por tipo.

do $$ begin
  create type arquivo_tipo as enum ('escopo', 'proposta', 'outro');
exception when duplicate_object then null;
end $$;

create table if not exists public.lead_arquivos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  lead_id     uuid not null references public.leads(id) on delete cascade,

  tipo        arquivo_tipo not null default 'escopo',
  nome        text not null,
  path        text not null,          -- caminho no bucket privado "leads"
  versao      int  not null default 1,
  atual       boolean not null default true,

  valor       numeric(12,2),          -- usado nas propostas
  observacao  text,
  created_by  uuid references auth.users(id)
);

create index if not exists lead_arquivos_lead_idx
  on public.lead_arquivos (lead_id, tipo, versao desc);

-- Um unico arquivo atual por lead e por tipo.
create unique index if not exists lead_arquivos_atual_idx
  on public.lead_arquivos (lead_id, tipo)
  where atual;

alter table public.lead_arquivos enable row level security;

create policy "equipe le arquivos"
  on public.lead_arquivos for select
  to authenticated
  using (true);

create policy "equipe insere arquivos"
  on public.lead_arquivos for insert
  to authenticated
  with check (true);

create policy "equipe atualiza arquivos"
  on public.lead_arquivos for update
  to authenticated
  using (true)
  with check (true);

create policy "equipe deleta arquivos"
  on public.lead_arquivos for delete
  to authenticated
  using (true);
