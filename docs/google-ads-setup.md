# Google Ads — conversoes offline

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
