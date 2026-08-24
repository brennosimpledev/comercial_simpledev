# Google Ads - conversoes offline

Referencia dos IDs e do estado da integracao. O codigo esta em
`src/lib/google/ads.ts`, com os gatilhos em `src/app/(app)/leads/actions.ts`.

## Contas

| O que | Valor |
|---|---|
| Conta de anuncios (onde a conversao entra) | `536-991-8697` -> `5369918697` |
| Conta de administrador / MCC (dona do token) | `850-555-5105` -> `8505555105` |
| Projeto Google Cloud | `simpledevcomercial` / numero `725285412417` |

## Acoes de conversao

| Acao | ID | Categoria | Valor | Contagem | Janela |
|---|---|---|---|---|---|
| Lead Qualificado - CRM | `7732596679` | Lead qualificado | R$200 fixo | Uma | 90 dias |
| Venda Fechada - CRM | `7732596682` | Lead convertido | variavel (padrao R$1) | Uma | 90 dias |

As categorias sao as que alimentam o relatorio "Funil de lead" do Google Ads.
Usar "Compra" em vez de "Lead convertido" faria a conversao entrar na conta
mas nao aparecer na coluna "Leads convertidos" do funil.

## Env vars

```
GOOGLE_ADS_DEVELOPER_TOKEN=<token da MCC>
GOOGLE_ADS_CUSTOMER_ID=5369918697
GOOGLE_ADS_LOGIN_CUSTOMER_ID=8505555105
GOOGLE_ADS_ACTION_QUALIFICADO=7732596679
GOOGLE_ADS_ACTION_FECHADO=7732596682
GOOGLE_ADS_API_VERSION=v21
```

`GOOGLE_ADS_API_VERSION` precisa ser conferida na documentacao: o Google
desliga versoes antigas periodicamente.

## Nivel de acesso do token

Todo developer token nasce em **Acesso as Analises**, que e somente leitura -
`uploadClickConversions` e escrita e falha nesse nivel. E preciso solicitar
**Acesso Basico** pela Central de APIs da MCC.

Aplicacao enviada em 24/08/2026. O documento de design exigido no formulario
esta em `SimpleDev-GoogleAdsAPI-DesignDoc.rtf`, nesta pasta.

## Observacoes

- As duas acoes sao "principais" mas **nao** sao metas padrao da conta: nao
  influenciam lance ate serem adicionadas como meta de uma campanha. Deixar
  assim ate ter 4-6 semanas de historico.
- Leads sem `gclid` (Meta, organico) sao registrados em `ads_conversions`
  com status `sem_gclid` e nunca sao enviados.
- A unique `(lead_id, tipo)` em `ads_conversions` e a trava de idempotencia:
  o Google soma cada upload, entao reenvio inflaria a campanha.
