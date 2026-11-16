-- Migration 0024: ChatGPT Ads (OpenAI)
--
-- Leads que chegam pelos anuncios do ChatGPT ganham origem propria e
-- guardam os identificadores que a OpenAI usa para atribuir a conversao:
--   oppref -> id do clique no anuncio (parametro ?oppref= na LP, cookie __oppref)
--   obref  -> id do navegador no site (cookie __obref)
-- Com eles o CRM manda lead qualificado, reuniao, fechamento etc. para a
-- API de conversoes da OpenAI, como ja faz com a Meta e o Google.

alter type lead_origin add value if not exists 'chatgpt_ads';

alter table public.leads
  add column if not exists openai_oppref text,
  add column if not exists openai_obref text;
