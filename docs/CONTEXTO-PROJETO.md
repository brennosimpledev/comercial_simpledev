# Contexto do projeto — CRM comercial SimpleDEV

Documento de transferência. Cobre o que **não** se descobre lendo o código:
decisões, armadilhas já pagas e estado das integrações externas.

---

## O que é

CRM comercial da SimpleDEV (desenvolvimento de software sob medida, Aparecida
de Goiânia-GO), substituindo um sistema legado em Bubble.

**Stack:** Next.js 16 (App Router, Server Actions) · Supabase (Postgres + RLS +
Storage) · Tailwind · deploy na Vercel.

| Recurso | Onde |
|---|---|
| Repositório | `github.com/brennosimpledev/comercial_simpledev` |
| Produção | `comercial-simpledev.vercel.app` |
| Supabase | projeto `comercialsimpledev` (`gmboahlpsivpmvgtxbcc`) |
| Local | `C:\Users\Brenno\Desktop\projetos\comercial_simpledev` |

**A conta Vercel do deploy não é a `brennodutra-8177`.** Essa conta enxerga
outros projetos (`lp-nova`, `lp-html-simpledev`, `project-ycgoj`), não o CRM.
Para ler logs é preciso entrar com a conta que detém o projeto.

---

## Fluxo do negócio

```
anúncio (Google / Meta) → lead entra no CRM → SDR qualifica →
reunião (Google Meet) → proposta → fechamento
        ↓                                    ↓
   conversão "qualificado"            conversão "fechado"
   volta para a plataforma            volta com o valor
```

O ponto do sistema é fechar esse ciclo: sem devolver o resultado, as
plataformas otimizam para **formulário preenchido**, que é o que não falta.
Medição de agosto/2026: R$ 30 por lead bruto contra ~R$ 360 por lead
qualificado.

---

## Entrada de leads — quatro caminhos

| Caminho | Rota | Identificador | Devolve conversão? |
|---|---|---|---|
| Landing page | `/api/webhook/lead` | `gclid` | ✅ Google |
| Meta Lead Ads | `/api/webhook/meta` | `meta_lead_id` | ✅ Meta |
| Click-to-WhatsApp | `/api/webhook/whatsapp` | `ctwa_clid` | ✅ Meta |
| WhatsApp orgânico | `/api/webhook/whatsapp` | — | ❌ |

O WhatsApp usa **Evolution API** (não a API oficial), evento
`messages.upsert`.

### A armadilha da atribuição

Anúncio que leva ao WhatsApp entregava o lead como mensagem, e tudo virava
`origem: whatsapp`. Isso inflava o orgânico e escondia o custo real de mídia.
Em agosto/2026, **59 de 81 leads "orgânicos" eram anúncio pago**.

Duas correções, com naturezas diferentes:

- **Click-to-WhatsApp** — determinística. O payload traz
  `contextInfo.externalAdReply` com `ctwaClid`, `sourceId` e `sourceApp`. A
  busca é recursiva porque o objeto aninha diferente conforme o tipo da
  mensagem.
- **Formulário repassado por automação (n8n)** — heurística. A mensagem traz o
  conteúdo do formulário sem metadado de anúncio; detectamos pelos nomes de
  campo (`work_email`, `full_name`, `phone_number`), não pela saudação — a
  saudação é texto do n8n e muda sem aviso.

O segundo caso **classifica mas não atribui**: sem identificador de clique não
há como devolver conversão. O n8n tem o `leadgen_id` e poderia incluí-lo na
mensagem — ou ser desligado desse fluxo, já que o webhook do CRM agora cria o
lead direto.

---

## Conversões offline

Orquestração em `src/lib/conversions/report.ts`, que roteia pelo identificador
do lead. Cada canal só implementa o envio. Detalhes completos em
`docs/conversoes-offline.md`.

### Google — use Data Manager, não a Google Ads API

`ConversionUploadService.uploadClickConversions` foi **fechado para novas
integrações** e responde `404 NOT_FOUND | Method not found.` em qualquer
versão. Não é nível de token nem versão da API — o método existe, só não para
quem chega agora.

Caminho atual: `datamanager.googleapis.com/v1/events:ingest`. **Não usa
developer token.**

`eventSource` é obrigatório para conversão offline e **não aparece no exemplo
oficial**. Sem ele: `REQUIRED_FIELD_MISSING`.

### 200 no Google não quer dizer conversão registrada

O `events:ingest` responde **200 só confirmando que aceitou a requisição**. O
casamento com os cliques roda depois, de forma assíncrona, e pode rejeitar
todos os registros. Em set/2026 o CRM marcava `enviado` nas 4 conversões
enquanto o console da Data Manager API mostrava **0% de sucesso**.

Por isso guardamos o `requestId` da resposta em `ads_conversions.request_id`
e conferimos o resultado real em `requestStatus:retrieve`, que devolve o
motivo por registro (`INVALID_CONVERSION_ACTION_TYPE`, `PERMISSION_DENIED`,
`TERMS_AND_CONDITIONS_NOT_SIGNED`, etc). Disponível ~30 min após o envio;
antes disso volta `PROCESSING`.

Rota: `GET /api/google/ads-status?secret=<CRON_SECRET>`. Com
`&reenviar=<id da linha>` reenvia uma conversão para capturar o requestId —
seguro porque o `transactionId` continua sendo o id da linha, então o próprio
Google deduplica.

### Meta — dois caminhos com regras opostas

| Caminho | `action_source` | Identificador | Nomes de evento |
|---|---|---|---|
| Formulário instantâneo | `system_generated` | `lead_id` | **livres** |
| Click-to-WhatsApp | `business_messaging` | `ctwa_clid` | **fechados** |

No segundo, nomes livres são recusados. Válidos: `QualifiedLead`, `Purchase`,
`LeadSubmitted`, `InitiateCheckout`, `AddToCart`, `ViewContent` e outros de
e-commerce.

O `debug_token` do token de CAPI mostra só `read_ads_dataset_quality` e mesmo
assim ele posta eventos — a permissão vem do usuário de sistema estar
atribuído ao dataset. **Não conclua pelo escopo que o token está errado.**

### Idempotência

`ads_conversions` tem unique `(lead_id, tipo, canal)`. As duas plataformas
**somam** cada envio; repetir infla a campanha. O `transactionId` / `event_id`
enviado é o id da nossa linha, o que dá deduplicação também do lado delas.

Fechamento sem valor entra como `aguardando_valor` e **não sobe**: a unique
impede corrigir depois, então um zero enviado seria permanente. Sobe quando
alguém preenche `valor_fechado`.

---

## Reuniões

Google Calendar + Meet via OAuth. Título padronizado `Nome — SimpleDEV`, o que
permite achar transcrição e gravação no Drive buscando pelo nome do lead.

Horário comercial 9h–12h e 14h–18h, seg–sex, intervalos de 10 min, validado no
cliente e no servidor.

**Token compartilhado:** `getTeamAccessToken()` usa o admin client para pegar
os tokens de qualquer conta Google conectada. Um admin conecta, o time todo
agenda. Sem isso a RLS bloquearia o SDR.

O modal traz transcrição, player da gravação (embed do Drive — quem assiste
precisa estar logado numa conta com acesso), anotações do SDR compartilhadas
com o lead, contagem ordinal de follow-ups e agendamento de nova reunião.

`scheduleMeeting` **só avança** o estágio: marcar a 2ª reunião com alguém em
proposta não pode puxá-lo de volta.

### Busca no Drive

Filtrar `mimeType` com `contains` **não funciona** — o operador não faz
substring nesse campo e engolia as gravações em vídeo. A query filtra por nome
e janela de tempo; o tipo é classificado no nosso código.

---

## Contas e IDs externos

| Serviço | Valor |
|---|---|
| Google Cloud | `valued-geode-504917-u7` (número `867274423429`) |
| Google Ads | `5369918697` · MCC `8505555105` |
| Ação "Lead Qualificado" | `7732596679` |
| Ação "Venda Fechada" | `7732596682` |
| App Meta | `882782074416957` |
| Página Facebook | `100188596406943` (SimpleDev) |
| CRM Pixel (dataset) | `36869866015945984` (crm_SD) |

**Cuidado com dois projetos GCP de nome parecido.** O `simpledevcomercial`
(`725285412417`) **não** é o do CRM — o client OAuth `comercialsimpledev` vive
no `valued-geode-504917-u7`. Essa confusão custou horas: APIs foram ativadas no
projeto errado três vezes.

Escopos OAuth em uso: `calendar.events`, `drive.readonly`, `datamanager`.
Adicionar escopo exige **reconectar** em `/api/google/connect`.

---

## O middleware engolia as rotas de serviço

O matcher do `middleware.ts` só excluía `api/webhook`. Qualquer requisição
sem cookie de sessão para `api/cron` levava **307 para /login** — ou seja, o
cron de follow-ups da Vercel, que chega sem sessão por definição, **nunca
executou** desde que foi criado.

Corrigido em set/2026 excluindo também `api/cron` e `api/google/ads-status`.
**Toda rota nova que se autentica por segredo próprio precisa entrar nessa
lista**, senão falha em silêncio: a rota não roda e o chamador recebe um
redirect, não um erro.

---

## Convenções do código

- Comentários e mensagens de commit em **português**, sem acentos no código
- Server Actions para mutação; `after()` do `next/server` para trabalho que não
  deve bloquear a resposta (envio de conversão)
- `createAdminClient()` (service role) quando é preciso furar RLS —
  webhooks, tokens do Google, tabelas de sistema
- Migrations em `supabase/migrations/`, aplicadas **manualmente** no SQL Editor
  do Supabase. Não há CLI linkada; a numeração é sequencial

---

## Pendências

**Otimização não está ligada.** Enviar conversão não muda o leilão sozinho:

- Google Ads: adicionar "Lead Qualificado — CRM" como meta da campanha
- Meta: usar a meta de performance "Conversion Leads"

Esperar 4–6 semanas de histórico antes. Ligar cedo faz o algoritmo recalibrar
sobre poucos eventos e piorar antes de melhorar.

**Diagnóstico de mídia não executado** (levantado em 26/08/2026):

- Negativar `base44`, `lovable`, `multi softcenter`, `[software]` — este último
  em correspondência **exata**, senão bloqueia as boas palavras-chave
- Pausar a duplicata em frase de `criar aplicativo para minha empresa`, que
  custa 2,2× por clique e converte pior que a versão em ampla
- Pausar Grupos 1 e 2, que gastam sem converter
- Resolver a ação de conversão "Enviar formulário de lead", em "Configuração
  incorreta", e a duplicata dela
- Revisar os 551 termos de pesquisa

**Integração do gerador de escopo.** Existe um pacote separado
(`simpledev-escopo-api`) rodando Claude Agent SDK que transforma transcrição em
escopo e proposta. **Não roda na Vercel** — precisa de servidor de longa
duração, filesystem gravável e execuções de minutos. Tem Dockerfile; a
integração seria hospedar à parte e chamar por HTTP.

**Etapas de pós-venda** na aba Clientes, ainda sem estrutura definida.

**Rotacionar credenciais** que passaram por chat: app secret da Meta, developer
token do Google, tokens do CRM Pixel.
