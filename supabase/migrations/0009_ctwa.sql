-- =====================================================================
-- Migration 0009: atribuicao de anuncios Click-to-WhatsApp
-- =====================================================================

-- Anuncio Click-to-WhatsApp entrega o lead como mensagem, entao o webhook do
-- WhatsApp criava tudo como origem 'whatsapp'. Mas o payload traz os dados do
-- anuncio em contextInfo.externalAdReply - da para atribuir com certeza.

-- Identificador de clique do Click-to-WhatsApp. E o equivalente do gclid:
-- permite devolver conversao a Meta por leads que chegaram pelo WhatsApp.
alter table public.leads add column if not exists ctwa_clid text;
-- ID do anuncio que originou a conversa.
alter table public.leads add column if not exists meta_ad_id text;

create index if not exists leads_ctwa_clid_idx
  on public.leads (ctwa_clid)
  where ctwa_clid is not null;

-- Backfill a partir da primeira mensagem recebida de cada lead. Regex sobre o
-- texto do payload em vez de caminho fixo no JSON: o objeto muda de forma
-- conforme o tipo da mensagem (texto, imagem, video), e o campo esta sempre
-- aninhado no mesmo formato.
update public.leads l
   set ctwa_clid  = sub.clid,
       meta_ad_id = sub.ad,
       -- Corrige a origem: o lead sempre foi de anuncio, so nao dava para saber.
       origem     = case when l.origem = 'whatsapp' then 'meta_ads' else l.origem end
  from (
    select distinct on (m.lead_id)
           m.lead_id,
           substring(m.raw::text from '"ctwaClid":\s*"([^"]+)"') as clid,
           substring(m.raw::text from '"sourceId":\s*"([^"]+)"') as ad
      from public.lead_messages m
     where m.direction = 'inbound'
       and m.raw::text like '%ctwaClid%'
     order by m.lead_id, m.created_at asc
  ) sub
 where l.id = sub.lead_id
   and sub.clid is not null
   and l.ctwa_clid is null;
