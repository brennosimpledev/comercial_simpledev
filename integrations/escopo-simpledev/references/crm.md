# Integração com o CRM SimpleDev

Esta referência descreve o fluxo de persistência da única skill `escopo-simpledev`.
O MCP usa uma conexão revogável por usuário do CRM. Cada chamada identifica o
projeto; o servidor verifica novamente a permissão do usuário em todas as
leituras e gravações. O escopo interno contém estimativas e premissas; nunca
envie esse JSON ao cliente.

## Pré-requisitos

1. No CRM, abra **Projetos** e crie ou selecione o projeto ligado ao lead correto.
   Confira nome do projeto e identificador do lead antes de escrever. O vínculo
   de projeto a lead não copia automaticamente os arquivos do lead para o escopo.
2. Em **Conexões**, crie uma conexão da conta e configure uma única vez o
   conector remoto `SimpleDev Delivery` no Claude:
   - URL: `https://comercial-simpledev.vercel.app/api/delivery/mcp`
   - Transporte: MCP Streamable HTTP (stateless)
   - Cabeçalho: `Authorization: Bearer <token>`
3. O token é exibido uma única vez, não expira e pode ser revogado em
   **Conexões**. Guarde-o apenas na configuração de segredo do conector. Nunca
   o inclua em prompts, arquivos, links, logs ou documentos. Não use a chave
   administrativa do Supabase.

Antes de criar o conector/token, confirme que a versão publicada do CRM inclui
a rota MCP e a migration de delivery. Se um POST de `initialize` responder 404
ou 405, essa versão ainda não está ativa: não tente conectar nem crie tokens;
gere o JSON localmente e informe que ele não foi salvo no CRM.

Se o projeto, lead ou conector não puder ser confirmado, pare antes de gravar e
peça a configuração correta. Não use um projeto de demonstração para um cliente.

## Salvar/revisar um escopo

1. Chame `listar_projetos` para localizar projetos e leads acessíveis, ou
   `criar_projeto` com o nome e `leadId` quando ainda não existir. Em seguida,
   chame `obter_projeto` com `projectId`. Confirme que o projeto e o `lead_id` correspondem ao
   cliente da conversa. O MCP busca leads pelo nome, mas não importa
   `lead_arquivos`;
   use as fontes fornecidas na conversa/Projeto e cite-as em `sources`.
2. Leia a versão atual antes de revisar. Preserve IDs estáveis de módulos,
   requisitos e decisões; nunca reutilize ID de requisito removido. Chame
   `obter_contrato` e construa o JSON conforme
   [`scope.schema.json`](scope.schema.json). Uma função é um requisito separado;
   vincule módulo, perfis e fonte. `included`, `optional`, `pending` e `excluded`
   representam inclusão comercial, não progresso. `pending` exige `decisionId`;
   uma resposta de decisão não altera automaticamente a inclusão. Mantenha
   horas, premissas, critérios de aceite e fontes. Use `hours: null` quando a
   estimativa não existir. Não infira horas, aceite, aprovação ou datas de PDF.
   Identifique critérios técnicos propostos como propostas, não como fala do
   cliente.
3. Chame `validar_escopo` com o documento completo. Corrija todos os erros antes
   de salvar. A validação não grava nada.
4. Chame `salvar_rascunho` com:
   - `document`: o JSON validado;
   - `expectedVersion`: `project.revision` devolvido por `obter_projeto` (zero
     quando o projeto ainda não tem gravação);
   - `requestId`: UUID aleatório para essa operação. Em timeout, repita uma
     única vez com o mesmo UUID e conteúdo. Em conflito de versão, releia e
     compare; não sobrescreva silenciosamente trabalho de outra pessoa.
5. Chame `obter_projeto` novamente e confirme a nova versão salva. Use esse
   snapshot como fonte para gerar o escopo interno e o documento de confirmação.
   Identifique projeto e versão. O documento de cliente deve remover `hours`,
   `assumptions` e `planningNotes`; use o exportador do CRM quando apropriado.
   Nunca invente URL de arquivo; registre a referência em `sources` quando
   estiver disponível.
6. Só depois de salvar e conferir a versão, informe no CRM que ela está pronta
   para revisão. `enviar_para_revisao` muda o estado do fluxo, mas não aprova.
   A aprovação e a evidência de aceite são registradas por uma pessoa no CRM.

Não grave uma segunda versão se não houve mudança. Em conflito de versão, releia
o projeto, compare as alterações e peça decisão quando não for possível mesclar
sem alterar a intenção comercial.

## Planejamento após aprovação

Só após confirmar em `obter_projeto` que a versão corrente está aprovada,
consulte o contrato `plan` e proponha tarefas com `salvar_plano`. Detalhe
arquitetura, dados, permissões, integrações, testes, critérios de aceite e
dependências. Vincule cada tarefa aos requisitos incluídos e use
`foundation: true` para atividades transversais; não inclua opcionais não
contratados. Responsáveis, horas, capacidade e datas desconhecidos permanecem
vazios/null. Não converta horas em prazo sem capacidade e calendário definidos.
Inclua a fundação operacional SimpleDev (domínio, responsáveis, repositório,
ambientes, hosting, Supabase, backups, e-mail e Bitwarden); acrescente serviços
como agendamento, WhatsApp, pagamentos ou IA somente quando os requisitos
incluídos os justificarem. Para clientes SimpleDev, GitHub, hosting, Supabase e
Bitwarden começam sob propriedade SimpleDev; outros modelos devem estar
explicitados no projeto. Aplique essa regra somente a projetos contratados pela
SimpleDev.

Para `expectedRevision`, use a
revisão do plano (`project.plan.revision`/`plan.revision`) devolvida por
`obter_projeto`, ou `0` quando ainda não houver plano; não use a revisão do
projeto para essa operação. O MCP não aprova tarefas concluídas nem fixa a
baseline; responsáveis, critérios, estimativas, datas, execução e baseline são
confirmados no CRM por uma pessoa. Consulte [`plan.schema.json`](plan.schema.json).

## Ferramentas disponíveis

| Ferramenta | Uso |
| --- | --- |
| `buscar_leads` | Buscar lead pelo nome e obter o leadId |
| `listar_projetos` | Listar projetos acessíveis e seus leadIds |
| `criar_projeto` | Criar projeto vinculado a um lead existente |
| `atualizar_projeto` | Atualizar o nome de um projeto acessível |
| `obter_contrato` | Contratos JSON de escopo e planejamento |
| `obter_projeto` | Versões, estado e planejamento (`projectId` obrigatório para a conexão da conta) |
| `validar_escopo` | Validar JSON sem persistir |
| `salvar_rascunho` | Criar snapshot versionado, sem aprovar |
| `comparar_versoes` | Conferir diferenças entre snapshots |
| `enviar_para_revisao` | Encaminhar uma versão para revisão humana |
| `salvar_plano` | Salvar proposta de planejamento ligada ao escopo aprovado |

Use o mesmo conector para todos os projetos. `listar_projetos` devolve os
projetos e respectivos `lead_id`; envie `projectId` em cada operação de leitura
ou gravação. O CRM verifica propriedade ou participação do usuário a cada
chamada. A conexão tem acesso somente aos projetos que o usuário consegue abrir
no CRM. Para criar projeto, busque o lead por nome com `buscar_leads` e use o
`leadId` retornado. Aprovação de escopo e baseline continuam registradas por
uma pessoa.

Associe `issueNumber`/`pullNumber` somente a registros reais do repositório
vinculado. PR integrado é evidência técnica, não aceite do cliente. Não marque
tarefa como concluída pelo MCP; a validação de execução é humana, com critério e
evidência. Após fixar a baseline, preserve o cronograma original e altere apenas
a previsão atual. Mudanças de escopo exigem nova versão e revisão.
