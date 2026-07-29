-- =====================================================================
-- Migration 0003: origem "workana" + policy de delete em lead_messages
-- =====================================================================

-- Nova origem: Workana (plataforma de freelas)
alter type lead_origin add value if not exists 'workana';

-- Garante que a exclusao de leads (que cascateia mensagens) tenha policy.
drop policy if exists "equipe deleta mensagens" on public.lead_messages;
create policy "equipe deleta mensagens"
  on public.lead_messages for delete
  to authenticated
  using (true);
