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

### Onde conferir se a conversão do Google entrou

Três indicadores diferentes, e **só um deles é o veredito**:

| Indicador | O que significa |
|---|---|
| `200` do `events:ingest` | a requisição foi aceita. **Não** diz que a conversão entrou |
| `requestStatus:retrieve` | status de processamento. Respondeu `SUCCESS` para um envio que o painel marcou como erro |
| Painel "Taxa de sucesso" da Data Manager API | **não reflete o registro da conversão.** Mostrou 0% em 5 envios enquanto 4 conversões estavam registradas |
| **Google Ads → Metas → Resumo → coluna "Todas as conv."** | **este é o veredito** |

Em 01/09/2026 essa confusão custou uma noite inteira de diagnóstico: o
painel mostrava 0% de sucesso, e a ação "Lead Qualificado - CRM" tinha 4
conversões e R$ 800 registrados — exatamente 4 × o
`GOOGLE_ADS_VALOR_QUALIFICADO`. Não havia problema nenhum para resolver.

**Antes de investigar falha de conversão no Google, abra a tela de ações de
conversão e olhe a contagem.** Se ela subiu, funcionou.

O `requestId` da resposta é gravado em `ads_conversions.request_id` e a
rota `GET /api/google/ads-status?secret=<CRON_SECRET>` consulta o
processamento — útil para erro de transporte, inútil para confirmar
registro.

### Reenviar com o mesmo transactionId vira "Ajustar", não "Adicionar"

O `transactionId` é o id da nossa linha, o que dá deduplicação. O efeito
colateral: reenviar a mesma linha faz o Google interpretar como **ajuste**
de uma conversão existente. Se a original nunca entrou, não há o que
ajustar e a operação falha. Reenvio só serve para corrigir valor, nunca
para recuperar uma conversão que não entrou.

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

### Click-to-WhatsApp não devolve conversão

Bloqueado do lado da Meta, não do código. O evento `business_messaging`
exige `page_id` ou `whatsapp_business_account_id` no `user_data` (já
enviamos via `META_PAGE_ID`), e além disso exige que **o dataset tenha uma
Página associada**.

O `crm_SD` não tem, e não existe caminho na interface para associar:
"Conectar ativos" do dataset só oferece contas de anúncios, e o da Página só
oferece Instagram. A conta do WhatsApp é "Simple Dev" (`435010563022816`),
tipo **Aplicativo WhatsApp Business** — a suspeita é que a API de
conversões de mensageria pressuponha a WhatsApp Business Platform.

São 37 leads com `ctwa_clid` sem retorno. Enquanto durar, priorizar Lead
Ads de formulário sobre Click-to-WhatsApp nas campanhas.

### Otimização da Meta: o evento precisa ser estágio positivo

Receber o evento não basta. Em **Gerenciador de Eventos → funil de vendas**,
o evento nasce em *Outros estágios* — a caixa do que a Meta trata como
**não** sendo lead de qualidade. Ficou assim de mai a set/2026: os eventos
chegavam e eram descartados para efeito de otimização.

Movido para *Estágios positivos* em 01/09/2026, com alvo de otimização
definido. É o que destrava a meta `QUALITY_LEAD` nos conjuntos de anúncios.

### Integração de CRM da Meta: o que ela exige (24/11/2026)

O Gerenciador de Eventos acusava "não podemos concluir a integração do seu
CRM nem otimizar a veiculação" e "baixa cobertura de leads". Três causas, as
três no código, corrigidas em 24/11:

- **Lead bruto para todo lead.** A Meta pede o estágio inicial de todos os
  leads e mede por ele a cobertura (mínimo de 60%). O CRM só enviava evento
  quando o lead mudava de etapa. Agora "Lead Recebido" sai para todo lead de
  formulário, pela rotina `/api/cron/openai-leads`. No funil do Gerenciador
  de Eventos ele tem que ficar em **Outros estágios**.
- **`custom_data.event_source = "crm"` e `lead_event_source`** são
  obrigatórios na especificação e não eram enviados.
- **E-mail e telefone em hash** junto do `lead_id` (a qualidade de
  correspondência estava em 0/10).

Também desde 24/11: "Reunião Marcada" e "Reunião Realizada" só vão para a
Meta se o lead é qualificado. São estágios positivos acima de "Lead
Qualificado" no funil, e a regra de 17/11 (horário para quem não recusou o
piso, sem qualificar) vazava por eles.

**A tela de edição do conjunto de anúncios engana.** Em conjunto já publicado
com fonte de sinal CRM, "Conjunto de dados" e "Evento de conversão" aparecem
em branco e travados. Não é defeito: pela API o conjunto está igual desde
15/09/2026 (`QUALITY_LEAD`, `promoted_object` só com a página), inclusive em
outubro, que foi o melhor mês. Não recriar o conjunto por causa disso — zera
o aprendizado. `/api/analise/meta-config?secret=...&historico=1` mostra a
configuração real e o histórico de alterações da conta.

**Novembro/2026 — o que derrubou a qualidade.** De 01 a 11/11 o bot de fora
de horário marcava "Lead Qualificado" sem critério: 9 dos 13 qualificados do
período foram desqualificados depois (em outubro, 1 de 32). A campanha otimiza
por esse evento, então aprendeu a buscar lead ruim. Em 24/11 o bot perdeu o
poder de qualificar: só gente marca, ou o lead se qualifica ao avançar no
funil do closer (escopo enviado em diante). O sinal sujo sai da janela da Meta
por volta de 09/12; até lá não mexer em campanha, conjunto ou criativo.

O criativo não é a causa: os dois fechamentos de R$ 50 mil de novembro vieram
do AD 22. Comparar criativo por taxa de qualificação no CRM, nunca por CPL.

**OneGarage.** O site da OneGarage carregava o pixel `36869866015945984` (o
dataset `crm_SD`) e mandava `PageView` para ele. Trocado em 24/11 pelo
dataset da OneGarage, `1434327361938656`.

### Formulário com um número, conversa por outro (24/11/2026)

Cerca de 1 em cada 5 leads de formulário preenche com um número e toca em
"falar no WhatsApp" de outro. Isso criava dois cards: o do formulário (com o
`meta_lead_id`, parado em "novo") e o da conversa (sem identificador).

O card parado parecia lixo e era excluído na tela de leads. Junto ia o
`meta_lead_id`, e a campanha perdia o retorno daquela pessoa. A conferência
de 24/11 achou 11 formulários de 11 a 24/11 sem card no CRM: 9 eram desse
tipo e 2 eram números sem WhatsApp. **Não foi falha do aviso da Meta** — dos
284 leads conferidos, todos entraram entre 4 e 19 segundos depois do
formulário, e o registro do banco mostrou a exclusão pela tela.

Desde 24/11 (`src/lib/leads/gemeos.ts`):

- a conversa nova que cita o e-mail do formulário entra no card do
  formulário, e o número do card passa a ser o da conversa;
- o formulário que chega depois da conversa entra no card da conversa;
- excluir um lead de formulário leva o formulário para o card da conversa
  antes; se a pessoa não conversa por nenhum outro card, a exclusão é
  recusada e o caminho é desqualificar;
- `/api/cron/meta-leads` confere os formulários com a Meta a cada 30 minutos
  e traz o que faltar.

`/api/analise/gemeos?secret=...&desde=AAAA-MM-DD&ate=AAAA-MM-DD` lista os
pares que ainda existem (janelas de até 5 dias, senão a rota estoura o
tempo) e `&juntar=parados` junta os que nunca foram trabalhados.
`/api/analise/meta-leads?secret=...&desde=...` confere lead a lead com a Meta.

**Registro do banco:** o plano gratuito do Supabase guarda só 1 dia. Para
saber quem excluiu ou alterou algo, olhar em Logs no mesmo dia.

### Pente fino da conta de anúncios (24/11/2026)

`/api/analise/meta-auditoria?secret=...` lê da Meta, de uma vez: situação da
conta e do pagamento, campanhas, conjuntos, anúncios (reprovação, formulário
usado, rastreamento), formulários, públicos, pessoas com acesso e a validade
dos três tokens. `&reserva=1` prova o token de reserva. `&ler=<id>[/aresta]
&campos=...&com=ads|pagina|crm` faz uma consulta avulsa de leitura. Nada
grava na Meta. As respostas nunca devolvem o token (a Graph o embute em
`paging.next`; as rotas trocam por `OCULTO`).

O que a conferência de 24/11 mostrou na CA 02:

- **A ligação conjunto de anúncios ↔ CRM está provada.** O relatório do
  conjunto (`insights` com `conversions`) traz
  `offsite_conversion.fb_pixel_custom.Lead Qualificado` (24 em 30 dias,
  R$ 369,63 cada) e `Lead Recebido`. Ou seja: os eventos do `crm_SD` são
  atribuídos aos anúncios, mesmo com `promoted_object` só com a página. O
  `crm_SD` está conectado à CA 01, à CA 02 e à CA 01 onegarage.
- **24 "Lead Qualificado" em 30 dias** é pouco para a Meta sair do
  aprendizado (ela pede ~50 por semana). A tela mostra "Ativo", sem alerta;
  o volume baixo é o limite real desta otimização, não um defeito.
- **Dataset `2524535781334252` ("SimpleDev")**: antigo, sem evento desde
  18/08/2026, conectado só à CA 01. Aparece no `tracking_specs` dos anúncios
  como resto histórico. Não recebe nada do CRM.
- **Token da página.** `META_PAGE_ACCESS_TOKEN` vem do login de uma pessoa e
  a Meta marcava o "acesso aos dados" dele como vencido desde 15/11 (ainda
  respondia em 24/11). O aviso de lead e a rotina de conferência usavam só
  ele. Agora, se ele falhar, os dois pedem um token da página ao usuário de
  sistema (`tokenDaPaginaReserva` em `lib/meta/leadgen.ts`), que não vence.
  Quando a reserva entra, sai no log "Renovar o token da pagina na Vercel".
  Teste: `/api/cron/meta-leads?secret=...&ensaio=1&testar_reserva=1`.
- **Cobrança.** O cartão padrão (Visa final 0109) falhou em todas as 15
  cobranças de 16/09 a 23/11; quem paga é o reserva (final 8070). Se o
  reserva falhar uma vez, a conta para de veicular.
- **Acesso.** Quatro pessoas com acesso total ao Business (Brenno, Glauco,
  Micael Mantelli com e-mail de outra empresa, e o perfil do Instagram);
  autenticação em dois fatores não é exigida de ninguém; empresa não
  verificada e sem razão social/endereço/site cadastrados. Sem parceiros e
  sem apps de terceiros conectados; só o app `Simple_leads` assina os leads
  da Página.
- **Formulário em uso** (`909280838465128`): idioma `en_US` (rótulos "Full
  name", "Phone number", "Work email" em inglês), tipo "mais volume", link de
  privacidade apontando para a raiz de `pages.simpledev.com.br`. Dois
  formulários ativos de mesmo nome e zero leads.
- **Região.** A campanha entrega no Brasil inteiro. De setembro a novembro,
  Norte e Nordeste foram 32% dos leads de formulário (141 de 439) e 1 dos 20
  que chegaram a escopo, apresentação, negociação, interesse ou fechamento;
  os três fechamentos vieram de SP, SC e MG. As campanhas antigas da CA 01
  eram restritas a nove estados do Sul, Sudeste e Centro-Oeste. Candidato a
  ajuste **depois** de 09/12 (mudar a região reinicia o aprendizado).
  Separando as duas regiões, o problema é o **Nordeste** (87 leads, 7%
  qualificados, 3% com reunião feita, 1 avanço) e o **Pará** (25 leads, 2
  qualificados, 1 reunião). O resto do Norte (29 leads, 8 qualificados, 6
  reuniões, nenhum avanço depois da reunião) é amostra pequena e não
  condena. Recomendação dada em 24/11: tirar Nordeste e Pará e, no mesmo
  dia, trocar o formulário por um em português do tipo "maior intenção"
  (formulário publicado não se edita; trocar o formulário do anúncio também
  reinicia o aprendizado, então as duas mudanças vão juntas).

### Troca de região e de formulário na Meta (24/11/2026, noite)

Decisão do Brenno: não esperar 09/12, porque a semana já estava sem reunião
(semanas de novembro: ~48 leads e ~3 chegando a reunião; outubro: ~31 e ~5).

- **Conjunto novo** `120250950776710447` "Leads qualidade — sem Nordeste e
  Pará (24/11)", na mesma campanha (`120246088668970447`, verba de campanha
  R$ 290/dia). Cópia do antigo com `excluded_geo_locations` dos nove estados
  do Nordeste e do Pará. O antigo (`120246088668980447`) fica **pausado, não
  apagado**: religar ele e pausar o novo desfaz tudo.
- **Formulário novo** `3594446980733869` "SimpleDev - Qualificacao PT - maior
  intencao (24/11/2026)": pt_BR, maior intenção, entrega flexível desligada.
  Três perguntas de clique (para quem é o projeto; quem decide; quanto
  pretende investir). "Menos de R$ 20 mil" **fecha o formulário sem criar
  lead** (lógica condicional da Meta; não existe na API, só na tela). A
  abertura já diz "projetos a partir de R$ 20 mil". As quatro perguntas do
  formulário antigo não separavam nada: toda opção dava 15–20% de
  qualificados e 9–14% de reunião.
- **Anúncios novos** no conjunto novo, mesmos vídeos e textos, apontando para
  o formulário novo: AD 22 `120250950844770447` e AD 23 `120250950845160447`
  ligados; AD 18 `120250950845520447` pausado (reserva). Criados pela API:
  `POST /{ad}/copies` falha porque o criativo antigo carrega
  `standard_enhancements` (descontinuado); o caminho é criar criativo novo
  sem esse campo e anúncio novo. Anúncio criado pela API **não** vem com o
  rastreio do `crm_SD`: foi preciso acrescentar em `tracking_specs`
  `offsite_conversion` e `leadgen_quality_conversion` com
  `fb_pixel: 36869866015945984`.
- **Nome dos campos.** Formulário em português manda `nome_completo`,
  `telefone` e `email_comercial` em vez de `full_name`, `phone_number` e
  `work_email`. `mapFields` (`lib/meta/leadgen.ts`) traduz na entrada; o
  reconhecimento da mensagem pronta do formulário no WhatsApp
  (`pareceFormularioMeta`) aceita os dois idiomas.
- **Teste com a landing page** (formulário do site em vez do nativo): adiado.
  Se for feito, é campanha própria com verba própria, comparando reunião
  feita por real gasto.

### Desfecho de quem não responde (24/11/2026)

Regra do Brenno: são 10 tentativas, 2 por dia; depois disso o lead é
desqualificado como não respondido e a Meta recebe o evento negativo.

- `/api/cron/desfecho` roda às 9h30 e 14h30 em dia útil, depois da régua.
  `?secret=...&ensaio=1` lista o que faria sem gravar. `DESFECHO_AUTO=0`
  desliga.
- **Tentativa** = um turno (manhã ou tarde, Brasília) com mensagem nossa
  depois da última fala do cliente, seja do bot, da régua ou do time. Várias
  mensagens no mesmo turno contam uma vez; resposta do cliente zera
  (`turnosDesdeCliente` em `lib/followups/situacao.ts`).
- A partir da **3ª** tentativa o card sai de "Novo" e vai para o estágio
  `sdr`, que passou a se chamar **"Tentando contato"** (era "Em contato" e
  estava sem uso). Só anda para a frente.
- Depois da **10ª**, com a régua automática encerrada e pelo menos 20 horas
  desde a nossa última mensagem: `desqualificarLead` (Perdido +
  desqualificado + evento para a Meta), `sem_resposta = true` e uma nota no
  card. No máximo 30 por rodada.
- Fica de fora quem falou por último, tem reunião, é cliente ou tem
  "próximo contato" marcado para o futuro.
- Antes disso o funil não tinha desfecho: lead atendido que sumia ficava em
  "Novo" para sempre e não mandava sinal nenhum para a Meta. Em 24/11, de 42
  leads de formulário em "Novo" nos últimos 10 dias, 29 tinham sido
  atendidos pelo Ronaldo e parado de responder.
- Lead que recebeu a despedida da régua antiga (4 passos, até 12/11) com
  menos de 10 tentativas reais **não** é desqualificado pela regra; o ensaio
  lista em `despedida_enviada_com_menos_de_10`.

### Revisão geral de 24/11/2026 (noite) e resgate do bot

Depois da troca de conjunto e formulário, CRM e Meta foram conferidos de
novo. O que a revisão deixou registrado:

- **Na tela da Meta, "Conjunto de dados" e "Evento de conversão" do conjunto
  aparecem vazios e cinza**, no conjunto novo e no antigo, com "Fonte de
  sinal: CRM". É o estado normal desta campanha (o antigo estava assim em
  outubro). A ligação com o `crm_SD` fica no **anúncio**, em Rastreamento:
  nos anúncios novos "Eventos de CRM" e "Eventos do site" mostram `crm_SD`;
  nos antigos "Eventos de CRM" aparecia em branco (apontava para o dataset
  antigo `2524535781334252`).
- **Resgate do bot** (`lib/bot/resgate.ts`, dentro de `/api/cron/cutucada`):
  o atendente responde no `after()` do aviso do WhatsApp e, se aquela
  execução morre, ninguém tentava de novo. Em 24/11 às 19:36 um lead ficou
  sem resposta assim (causa não identificada: os logs da Vercel não estavam
  acessíveis). Agora, fora do expediente, quem tem a última fala há 4 a 45
  minutos recebe nova tentativa do mesmo atendente, com todas as travas
  dele. `?ensaio=1` mostra em `resgate.sem_resposta_do_bot` quem está nessa
  situação.
- **Cadastro público do Supabase segue aberto** (`disable_signup: false`,
  com confirmação de e-mail). Sem login nenhuma tabela devolve dado. Fechar
  em Authentication → Sign In / Providers é decisão do Brenno.
- **Cobrança**: cartão padrão (final 0109) continua falhando; a última
  cobrança (23/11, R$ 991,79) foi paga pelo reserva (final 8070).
- Portas conferidas sem credencial: webhooks `meta`, `whatsapp`,
  `whatsapp-closer`, `lead` e `formulario` recusam o POST (401); rotas de
  cron e de análise recusam sem o segredo (401).

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

Horário comercial 9h–12h e 14h–18h, seg–sex, só hora cheia, validado no
cliente e no servidor.

**Janela estendida do closer (26/11/2026).** Só o login
`brenno@simpledev.com.br` marca e remarca também no almoço (12h e 13h) e às
18h (reunião até 19h). A lista de logins e a regra ficam em
`lib/janelaReuniao.ts`; as telas (lead, funil, agenda) recebem
`horarioEstendido` do servidor e as actions `scheduleMeeting` /
`rescheduleMeeting` validam pelo e-mail de quem está logado, então o SDR não
passa nem forçando a chamada. O bot tem a janela própria (`HORAS_INICIO` em
`lib/agenda.ts`) e `agendarPeloBot` / `remarcarPeloBot` recusam qualquer
horário fora dela (`fora_da_janela`), mesmo que a IA devolva um.

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

Atualizado em 01/09/2026.

### Bloqueado, sem solução conhecida

- **Click-to-WhatsApp não devolve conversão.** Ver a seção própria acima. 37
  leads afetados. Enquanto durar, priorizar Lead Ads de formulário nas
  campanhas da Meta.

### A fazer no Google Ads

- **Desativar "Enviar formulário de lead"** — está em "Configuração
  incorreta", conta "Todas" as conversões por clique, tem zero registros e
  mesmo assim é principal e entra nas metas da conta. A versão "(1)" é a
  que funciona (152 conversões).
- Negativar `base44`, `lovable`, `multi softcenter` e `[software]` — o
  último em correspondência **exata**, senão bloqueia as boas palavras-chave
- Pausar a duplicata em frase de `criar aplicativo para minha empresa`, que
  custa 2,2× por clique e converte pior que a versão em ampla
- Pausar Grupos 1 e 2, que gastam sem converter
- Revisar os 551 termos de pesquisa
- Pausar as 22 palavras-chave em correspondência ampla: a migração para
  frase nunca terminou e a ampla responde por 43% dos cliques

### A verificar

- **O webhook da Meta dispara para todos os formulários?** 48% dos leads
  históricos de `meta_ads` chegaram sem identificador nenhum. Parte é
  histórico (o webhook demorou a funcionar), parte pode ser assinatura
  faltando. A consulta que separa as hipóteses agrupa por semana e conta
  `meta_lead_id is null and ctwa_clid is null`: se cair nas semanas
  recentes, era histórico e está resolvido.
- **A campanha META_LEAD_FORMULARIO — qualidade** (`QUALITY_LEAD`, ligada em
  01/09) entrega? Medir por taxa de qualificação no CRM, **não** por CPL —
  ela vai ter CPL pior por definição. Prazo de decisão: 8 semanas.
- **O CPL da campanha principal** depois do orçamento subir de R$ 170 para
  R$ 270/dia. Referência: R$ 49,41.

### Segurança

- **O token do `/api/webhook/lead` está em texto aberto no HTML da landing
  page.** Qualquer um que abra o código-fonte cria lead na base. A
  deduplicação por telefone reduz o dano, não elimina.
- **Rotacionar credenciais** que passaram por chat: app secret da Meta,
  developer token do Google, tokens do CRM Pixel e o `CRON_SECRET`.

### Dívida de dados

- **45 grupos de leads duplicados** anteriores a 01/09. Consolidar exige
  cuidado com reuniões, anotações e follow-ups — tarefa própria, não
  limpeza rápida.
- **Os 3 caminhos de entrada agora deduplicam por telefone**, então o
  problema parou de crescer.

### Produto

- **Integração do gerador de escopo.** Pacote separado
  (`simpledev-escopo-api`) rodando Claude Agent SDK que transforma
  transcrição em escopo e proposta. **Não roda na Vercel** — precisa de
  servidor de longa duração, filesystem gravável e execuções de minutos.
  Tem Dockerfile; a integração seria hospedar à parte e chamar por HTTP.
- **Etapas de pós-venda** na aba Clientes, ainda sem estrutura definida.

### Resolvido em 01/09/2026

- Meta: evento movido de *Outros estágios* para *Estágios positivos*, com
  alvo de otimização — era o que impedia `QUALITY_LEAD` de funcionar
- Meta: CA 01 conectada ao dataset `crm_SD`
- Deduplicação por telefone nos webhooks da Meta e da landing page
- Captura de `gbraid`/`wbraid` (iOS) nos três caminhos
- Landing page: lead enviado ao CRM antes do `window.open`, com `keepalive`
- Middleware: rotas de serviço deixaram de levar 307 para /login — o cron de
  follow-ups nunca havia executado
