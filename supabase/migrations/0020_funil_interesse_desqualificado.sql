-- =====================================================================
-- Migration 0020: funil do closer com "Interesse de fechamento" e
-- "Desqualificado"
-- =====================================================================
--
-- Interesse de fechamento: entre Negociacao e Fechado, o cliente disse
-- que quer fechar mas ainda nao assinou/pagou.
-- Desqualificado: ao lado de Perdido. Perdido e quem era bom e nao fechou;
-- desqualificado e lead ruim que passou do SDR e chegou na reuniao. Serve
-- para medir quantos o SDR deixou passar e ensina a Meta (evento negativo).

alter type lead_stage add value if not exists 'interesse' before 'fechado';
alter type lead_stage add value if not exists 'desqualificado';

-- OPCIONAL, rode DEPOIS e separado (o Postgres nao deixa usar o valor novo
-- do enum na mesma execucao): move para a coluna nova quem ja foi marcado
-- como desqualificado depois de uma reuniao realizada.
--
-- update public.leads l
--    set estagio = 'desqualificado'
--  where l.estagio = 'perdido'
--    and l.desqualificado
--    and exists (
--      select 1 from public.meetings m
--       where m.lead_id = l.id and m.status = 'realizada'
--    );
