-- =====================================================================
-- SimpleDEV Comercial (CRM)
-- Migration 0002: flags de qualificacao, conversa de WhatsApp e follow-ups
-- =====================================================================

-- ---------- Nova origem: whatsapp (inbound direto) ----------
alter type lead_origin add value if not exists 'whatsapp';

-- ---------- Flags e campos operacionais em leads ----------
alter table public.leads
  add column if not exists qualificado    boolean not null default false,
  add column if not exists sem_resposta   boolean not null default false,
  add column if not exists desqualificado boolean not null default false,
  add column if not exists bot_pausado    boolean not null default false,
  add column if not exists descricao      text,
  -- Digitos do whatsapp (para casar mensagens recebidas com o lead).
  add column if not exists whatsapp_digits text
    generated always as (regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')) stored;

create index if not exists leads_whatsapp_digits_idx on public.leads (whatsapp_digits);
create index if not exists leads_qualificado_idx     on public.leads (qualificado);

-- ---------- Conversa de WhatsApp ----------
create type message_direction as enum ('inbound', 'outbound');

create table public.lead_messages (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  direction    message_direction not null,
  body         text,
  media_url    text,
  media_type   text,
  wa_message_id text,                       -- id da mensagem no WhatsApp/Evolution
  status       text,                        -- sent | delivered | read | received | failed
  sent_by      uuid references auth.users(id) on delete set null,
  raw          jsonb
);

create index lead_messages_lead_idx    on public.lead_messages (lead_id, created_at);
create unique index lead_messages_wa_id_uniq
  on public.lead_messages (wa_message_id) where wa_message_id is not null;

-- ---------- Follow-ups (regua) ----------
create type followup_status as enum ('pendente', 'enviado', 'cancelado', 'pulado');

create table public.follow_ups (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  template_key  text not null,              -- ex: 'abordagem_12h'
  titulo        text,                       -- ex: 'Abordagem'
  body          text not null,              -- mensagem ja com o nome preenchido
  scheduled_at  timestamptz not null,       -- quando o bot deve enviar
  sent_at       timestamptz,
  status        followup_status not null default 'pendente',
  canal         text not null default 'whatsapp',
  sent_by       uuid references auth.users(id) on delete set null
);

create index follow_ups_lead_idx  on public.follow_ups (lead_id, scheduled_at);
create index follow_ups_due_idx   on public.follow_ups (status, scheduled_at);

-- ---------- updated_at ja existe para leads; nada a fazer aqui ----------

-- ---------- RLS ----------
alter table public.lead_messages enable row level security;
alter table public.follow_ups    enable row level security;

create policy "equipe le mensagens"      on public.lead_messages for select to authenticated using (true);
create policy "equipe insere mensagens"  on public.lead_messages for insert to authenticated with check (true);
create policy "equipe atualiza mensagens" on public.lead_messages for update to authenticated using (true) with check (true);

create policy "equipe le followups"      on public.follow_ups for select to authenticated using (true);
create policy "equipe insere followups"  on public.follow_ups for insert to authenticated with check (true);
create policy "equipe atualiza followups" on public.follow_ups for update to authenticated using (true) with check (true);
create policy "equipe deleta followups"  on public.follow_ups for delete to authenticated using (true);
