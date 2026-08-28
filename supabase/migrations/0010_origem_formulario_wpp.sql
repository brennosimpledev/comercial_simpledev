-- =====================================================================
-- Migration 0010: corrige origem de formularios da Meta repassados por WhatsApp
-- =====================================================================

-- A automacao que recebe o lead do formulario instantaneo manda a mensagem
-- pelo WhatsApp sem metadado de anuncio. Esses leads entraram como 'whatsapp'
-- e inflaram o organico, escondendo o custo real da Meta.
--
-- Casa pelos nomes de campo do formulario, nao pela saudacao: a saudacao e
-- texto da automacao e pode mudar; os nomes de campo vem da Meta.
update public.leads l
   set origem     = 'meta_ads',
       utm_source = coalesce(l.utm_source, 'meta'),
       utm_medium = coalesce(l.utm_medium, 'paid')
 where l.origem = 'whatsapp'
   and l.ctwa_clid is null
   and exists (
     select 1
       from public.lead_messages m
      where m.lead_id = l.id
        and m.direction = 'inbound'
        and m.body ilike '%work_email:%'
        and m.body ilike '%full_name:%'
   );
