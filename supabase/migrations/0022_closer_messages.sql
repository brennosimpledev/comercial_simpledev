-- Migration 0022: conversas do WhatsApp do closer
--
-- O closer (Brenno) conversa com os leads pelo proprio WhatsApp, fora da
-- linha do SDR. Sem isso o CRM nao enxerga o que acontece entre a primeira
-- e a segunda reuniao.
--
-- Tabela separada de lead_messages de proposito: o bot, a regua e a fila do
-- SDR leem lead_messages, e uma mensagem do closer la mudaria o
-- comportamento deles (o lead pareceria "esperando resposta" do SDR).
-- Aqui entra so conversa com numero que ja e lead; contato pessoal do
-- closer nunca vira registro.

create table if not exists public.closer_messages (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  direction     text not null check (direction in ('inbound', 'outbound')),
  body          text,
  media_type    text,
  wa_message_id text unique,
  sent_at       timestamptz not null default now()
);

create index if not exists closer_messages_lead_idx
  on public.closer_messages (lead_id, sent_at);

-- Sem policy: so o servidor (service role) le e grava.
alter table public.closer_messages enable row level security;
