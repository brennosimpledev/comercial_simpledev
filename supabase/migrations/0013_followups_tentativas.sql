-- =====================================================================
-- Migration 0013: tentativas e desistencia na regua de follow-up
-- =====================================================================
--
-- Com a Evolution fora do ar, o cron tentava enviar, falhava, mantinha o
-- follow-up como "pendente" e voltava a tentar 15 minutos depois. Os
-- mesmos ~25 registros foram retentados 96 vezes por dia durante uma
-- semana - e cada tentativa gravava uma linha em lead_messages, enchendo
-- o historico de conversas com milhares de mensagens fantasma.

alter type followup_status add value if not exists 'falhou';

alter table public.follow_ups
  add column if not exists tentativas int not null default 0;

alter table public.follow_ups
  add column if not exists ultimo_erro text;

-- O cron passa a processar por ordem de agendamento; sem isso o Postgres
-- devolve sempre o mesmo punhado quando ha limite.
create index if not exists follow_ups_pendentes_idx
  on public.follow_ups (scheduled_at)
  where status = 'pendente';
