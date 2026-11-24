-- Migration 0025: upsells (vendas novas para quem ja e cliente)
--
-- Por que tabela propria e nao somar em leads.valor_fechado:
--   1. valor_fechado e o valor do contrato que originou o cliente. Somar o
--      upsell nele apagaria essa informacao.
--   2. salvarValorFechado dispara conversao para Meta e Google quando o lead
--      esta em "fechado". Mexer no campo reabriria esse envio.
--   3. ads_conversions tem unique (lead_id, tipo): o evento "fechado" daquele
--      lead ja foi enviado uma vez e nao cabe de novo.
--
-- Upsell NAO sobe para as plataformas de anuncio: quando a venda nova
-- acontece, a janela de atribuicao da Meta e do Google (30 a 90 dias desde o
-- clique) ja fechou, entao o evento seria recusado ou ignorado. Fica como
-- receita no CRM. O historico esta aqui caso essa decisao mude.

create table if not exists public.lead_upsells (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  valor       numeric(12,2) not null check (valor > 0),
  descricao   text,
  data        date not null default current_date,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

-- Toda leitura parte do lead (card do funil e painel de fechamento), e sem
-- indice na chave estrangeira o delete em cascata de leads varre a tabela.
create index if not exists lead_upsells_lead_id_idx
  on public.lead_upsells (lead_id);

alter table public.lead_upsells enable row level security;

-- Mesmo criterio de leads: CRM interno, a equipe inteira enxerga tudo.
create policy "equipe le upsells"
  on public.lead_upsells for select
  to authenticated
  using (true);

create policy "equipe insere upsells"
  on public.lead_upsells for insert
  to authenticated
  with check (true);

create policy "equipe atualiza upsells"
  on public.lead_upsells for update
  to authenticated
  using (true)
  with check (true);

create policy "equipe deleta upsells"
  on public.lead_upsells for delete
  to authenticated
  using (true);
