# Conversoes offline — Google Ads e Meta

O CRM devolve dois estagios do funil para as plataformas: **qualificado**
(quando o SDR liga a flag) e **fechado** (quando o lead vai para esse estagio).
Sem isso, as plataformas otimizam para formulario preenchido, que e o que nao
falta; com isso, passam a mirar em quem vira negocio.

Orquestracao em `src/lib/conversions/report.ts`, que decide o canal pelo
identificador do lead: `gclid` vai para o Google, `meta_lead_id` vai para a
Meta. Cada canal so implementa o envio.

Acompanhamento dos dois de uma vez:

```sql
select canal, tipo, status, count(*)
from ads_conversions group by 1,2,3 order by 1,2;
```

Status possiveis: `enviado`, `erro`, `pendente`, `aguardando_valor`
(fechamento esperando o valor do contrato), `sem_gclid` / `sem_lead_id`
(o lead nao veio daquele canal — nao e falha).

---

# Google Ads

O CRM envia conversao para o Google Ads quando o SDR marca um lead como
qualificado ou o lead vai para o estagio fechado. Codigo em
`src/lib/google/ads.ts`, gatilhos em `src/app/(app)/leads/actions.ts`.

## Usa a Data Manager API, nao a Google Ads API

O `ConversionUploadService.uploadClickConversions` da Google Ads API foi
**fechado para novas integracoes**. A resposta do Google e literal:

> New integrations for uploading click conversions should use the Data Manager
> API. Usage of ConversionUploadService.UploadClickConversions is limited to
> existing users.

Enquanto se tenta usa-lo, a API responde `404 NOT_FOUND | Method not found.` em
qualquer versao — o metodo existe, mas nao para quem chega agora. Nao adianta
trocar de versao nem revisar o developer token.

O caminho atual e `POST https://datamanager.googleapis.com/v1/events:ingest`.
Documentacao: https://developers.google.com/data-manager/api/devguides/events/google-ads/offline

**Developer token nao e mais necessario.** A Data Manager API nao usa.

## Contas

| O que | Valor |
|---|---|
| Conta de anuncios (dona da acao de conversao) | `536-991-8697` -> `5369918697` |
| Conta de administrador / MCC | `850-555-5105` -> `8505555105` |
| Projeto Google Cloud | `valued-geode-504917-u7` / numero `867274423429` |

O projeto do Cloud e o que detem o client OAuth `comercialsimpledev`, e nao o
`simpledevcomercial` (725285412417) — confundir os dois custou horas.

## Acoes de conversao

| Acao | ID | Categoria | Valor | Contagem | Janela |
|---|---|---|---|---|---|
| Lead Qualificado - CRM | `7732596679` | Lead qualificado | R$200 fixo | Uma | 90 dias |
| Venda Fechada - CRM | `7732596682` | Lead convertido | variavel (padrao R$1) | Uma | 90 dias |

Precisam ser do tipo **UPLOAD_CLICKS** ("Importar de cliques"). As categorias
sao as que alimentam o relatorio "Funil de lead"; usar "Compra" em vez de
"Lead convertido" faria a conversao entrar na conta mas nao aparecer no funil.

## Pre-requisitos no Google Cloud

1. **Data Manager API ativada** no projeto `valued-geode-504917-u7`
2. Escopo OAuth `https://www.googleapis.com/auth/datamanager` concedido —
   esta em `src/lib/google/oauth.ts`; adicionar escopo exige reconectar o
   Google em `/api/google/connect`

## Env vars

```
GOOGLE_ADS_CUSTOMER_ID=5369918697
GOOGLE_ADS_LOGIN_CUSTOMER_ID=8505555105
GOOGLE_ADS_ACTION_QUALIFICADO=7732596679
GOOGLE_ADS_ACTION_FECHADO=7732596682
GOOGLE_ADS_VALOR_QUALIFICADO=200
GOOGLE_ADS_VALOR_FECHADO_PADRAO=0
GOOGLE_ADS_EVENT_SOURCE=OTHER
GOOGLE_ADS_CONSENT=
```

## Armadilhas ja encontradas

**`eventSource` e obrigatorio** para conversao offline e nao aparece no
exemplo da documentacao de send-events. Sem ele: `REQUIRED_FIELD_MISSING`.
Valores: `WEB`, `APP`, `IN_STORE`, `PHONE`, `OTHER`.

**Consentimento fica desligado por padrao.** Declarar `CONSENT_GRANTED` e uma
afirmacao juridica sobre como o dado foi coletado, nao um ajuste tecnico.

**`fieldWarnings` numa resposta 200 conta como falha** no nosso codigo. A API
aceita o evento e avisa que ignorou campos; tratar isso como sucesso esconderia
dado que nunca chegou a campanha.

**A unique `(lead_id, tipo)` em `ads_conversions` e a trava de idempotencia.**
O Google soma cada envio, entao reenviar a mesma conversao infla a campanha. O
`transactionId` enviado e o id da nossa linha, o que da deduplicacao tambem do
lado deles.

## Observacoes

- As duas acoes sao "principais" mas **nao** sao metas padrao da conta: nao
  influenciam lance ate serem adicionadas como meta de uma campanha. Deixar
  assim ate ter 4-6 semanas de historico.
- Leads sem `gclid` (Meta, organico) ficam com status `sem_gclid` e nunca sao
  enviados.

## Conferir

```sql
select tipo, status, erro, uploaded_at
from ads_conversions order by created_at desc limit 10;
```


---

# Meta — Conversions API para CRM

Codigo em `src/lib/meta/conversions.ts`.

## Identificador

O `leadgen_id` do Lead Ads, guardado em `leads.meta_lead_id`. So funciona
para leads de formulario instantaneo — nao ha equivalente para trafego de site.

## Conjunto de dados

| O que | Valor |
|---|---|
| CRM Pixel (dataset) | `36869866015945984` (crm_SD) |
| Endpoint | `POST https://graph.facebook.com/v21.0/{dataset}/events` |

Precisa ser um dataset do tipo **CRM**, nao pixel de site: evento de CRM
mandado para pixel de site nao casa com o `lead_id`.

## Env vars

```
META_CRM_PIXEL_ID=36869866015945984
META_CRM_ACCESS_TOKEN=<Configuracoes do dataset -> Gerar token de acesso>
META_EVENT_QUALIFICADO=Lead Qualificado
META_EVENT_FECHADO=Venda Fechada
```

Os nomes de evento sao **livres por definicao da Meta** — ela espera os
estagios do seu CRM. Mudar aqui sem mudar no Gerenciador de Eventos faz os
eventos chegarem sem casar com nada.

## Armadilhas ja encontradas

**O `debug_token` mostra so `read_ads_dataset_quality`** e mesmo assim o
token posta eventos. A permissao vem do usuario de sistema estar atribuido ao
dataset, nao de um escopo OAuth. Nao conclua pelo escopo que o token esta
errado — teste postando.

**`value` e `currency` sao aceitos** em `custom_data`. A documentacao de
CRM nao confirma, mas o teste voltou com `messages: []`, sem aviso. Entao o
fechamento carrega o valor real do contrato.

**`action_source` tem que ser `system_generated`.** Evento de sistema
dispensa user agent e URL, exigidos em evento de navegacao.

**`event_time` em Unix segundos**, e precisa ser posterior a geracao do lead.

## Testar sem sujar producao

Na aba **Eventos de teste** do dataset, escolha o canal **CRM**. A Meta oferece
um *lead de verificacao* com dados dummy — dispare contra o id dele. Resposta
esperada:

```json
{"events_received":1,"messages":[]}
```

`messages` vazio quer dizer nenhum campo recusado.

---

# O que falta para virar otimizacao

Enviar nao basta: o dado so muda o leilao quando a campanha usa o objetivo
certo.

- **Google Ads:** adicionar "Lead Qualificado - CRM" como meta da campanha.
  Ate la as acoes coletam dado sem influenciar lance.
- **Meta:** usar a meta de performance **Conversion Leads**, que exige
  formulario instantaneo.

Nos dois casos, espere 4-6 semanas de historico antes de ligar. Ligar cedo faz
o algoritmo recalibrar sobre poucos eventos e piorar antes de melhorar.
