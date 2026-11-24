-- Migration 0026: marca de mensagem automatica na linha do closer
--
-- Depois da primeira reuniao realizada, lembrete e confirmacao de reuniao
-- saem pelo WhatsApp do closer, nao mais pelo do SDR. O cron de lembretes e
-- o bot de reuniao precisam separar o que foi automatico do que o closer
-- escreveu a mao: com o closer falando, o lembrete nao atropela, e resposta
-- a um lembrete deixa o bot confirmar. Em lead_messages isso ja vem de
-- raw.bot / raw.lembrete; closer_messages nao tinha a coluna.
--
-- Mensagem que o proprio closer manda chega pelo webhook com raw nulo e
-- conta como humana, que e o que deve ser.

alter table public.closer_messages
  add column if not exists raw jsonb;
