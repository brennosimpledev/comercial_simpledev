-- =====================================================================
-- Migration 0006: link da gravacao da reuniao (Google Drive)
-- =====================================================================

-- A transcricao ja tinha coluna propria; a gravacao precisa da dela para
-- as duas poderem coexistir na mesma reuniao.
alter table public.meetings add column if not exists gravacao text;
