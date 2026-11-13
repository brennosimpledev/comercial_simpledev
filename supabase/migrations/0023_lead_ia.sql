-- Migration 0023: proximo passo sugerido pela IA no Funil
--
-- A IA le a conversa do closer, a do SDR, os follow-ups, os documentos e a
-- transcricao da ultima reuniao e sugere o proximo passo. Guarda aqui para
-- nao gastar a IA de novo toda vez que o card abre: so refaz quando chega
-- coisa nova (chave muda) ou virou o dia.

create table if not exists public.lead_ia (
  lead_id          uuid primary key references public.leads(id) on delete cascade,
  chave            text not null,
  sugestao         jsonb not null,
  gerado_em        timestamptz not null default now(),
  -- Quando a IA criou um follow-up sozinha (cron), para nao repetir.
  auto_followup_em timestamptz
);

-- Sem policy: so o servidor (service role) le e grava.
alter table public.lead_ia enable row level security;
