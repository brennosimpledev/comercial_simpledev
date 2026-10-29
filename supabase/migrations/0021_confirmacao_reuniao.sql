-- =====================================================================
-- Migration 0021: confirmacao e lembretes de reuniao
-- =====================================================================
--
-- Vespera as 10h: pede confirmacao. 1h antes: lembra com o link. Furou:
-- oferece horarios para remarcar. A resposta do cliente vira o status de
-- confirmacao que a agenda mostra, e o bot remarca sozinho quando o
-- cliente pede (fora do horario, ou se o time nao responder em 20 min).

alter table public.meetings
  -- Quando o horario atual foi marcado (criacao ou ultima remarcacao).
  add column if not exists marcada_em timestamptz not null default now(),
  -- confirmada | remarcar | cancelar
  add column if not exists confirmacao text,
  add column if not exists confirmacao_em timestamptz,
  add column if not exists lembrete_vespera_em timestamptz,
  add column if not exists lembrete_1h_em timestamptz,
  add column if not exists aviso_furo_em timestamptz,
  -- Ultima mensagem do cliente que o bot ja avaliou, para nao repetir.
  add column if not exists bot_ultima_msg text;

update public.meetings set marcada_em = created_at where marcada_em > created_at;

create index if not exists meetings_status_starts_idx
  on public.meetings (status, starts_at);
