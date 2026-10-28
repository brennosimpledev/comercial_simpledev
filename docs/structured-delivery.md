# Escopos estruturados e execução

## Implementado

O módulo `/projetos` cria projetos ligados a leads existentes. O responsável
compartilha o projeto com usuários internos existentes por UUID. Projetos são
isolados por RLS; membros leem estimativas internas e editam rascunhos/planos.
Somente o responsável aprova versões e fixa a baseline. Não há portal público
de cliente nesta entrega.

Importação/exportação JSON, histórico, comparação, decisões e revisão estão
integrados. Cada salvamento do escopo cria um snapshot, com idempotência por
requestId e controle de concorrência por versão. Aprovações registram nome,
evidência e versão; não constituem assinatura eletrônica. Arquivos já existentes
em `lead_arquivos` continuam intactos. Use `sources.reference` para indicar o
documento/reunião original, incluindo o ID de arquivo quando disponível.

O JSON interno contém horas e premissas; a exportação de cliente remove esses
campos. Não compartilhar o JSON interno com clientes. O PDF/DOCX continua
sendo gerado pela skill existente no Claude, a partir da versão salva.

Planejamento gera uma proposta inicial somente para requisitos incluídos,
mais tarefas de fundação/QA/segurança/entrega. Campos técnicos ficam pendentes
até o planejamento humano/Claude; geração inicial não inventa arquitetura.
O editor de planejamento é JSON e a execução possui formulário por tarefa.
Documentação Markdown e checklist podem ser baixados. Gantt mostra datas
fornecidas e baseline, sem prometer cálculo automático de caminho crítico ou
nivelamento de recursos. Validação rejeita ciclos, datas inválidas e dependências
fora de sequência. Progresso por esforço só aparece se todas as horas existirem.

## Ativação por ambiente

1. Aplicar `supabase/migrations/0019_delivery.sql` no ambiente de destino,
   inicialmente de testes. Não reaplicar a migration se já existir.
2. Configurar as variáveis Supabase existentes com chaves válidas. A chave
   administrativa é usada apenas no servidor; nunca no Claude ou navegador.
3. Executar `npm ci`, `npm run test:delivery`, `npm run build` e publicar a branch
   aprovada no ambiente desejado. Este desenvolvimento não aplica migration,
   não cria dados e não publica nada automaticamente em produção.
4. Em Projetos, criar um projeto de teste ligado a um lead de teste e importar
   `examples/delivery/synthetic.scope.json`. O fixture contém requisitos e
   decisões fictícios para testar importação, validação e planejamento. Não é
   um escopo de cliente nem prova de aprovação.
5. Registrar decisões/inclusões, enviar para revisão e registrar aprovação
   com evidência. Gerar plano, completar critérios/datas/responsáveis, salvar
   e fixar cronograma original. Ajustes posteriores não apagam essa baseline.

## Conectar o Claude

No projeto, Conexões → criar token. O banco guarda somente SHA256; o segredo
é exibido uma vez, expira em 30 dias e pode ser revogado. Token dá acesso a
apenas um projeto e perde acesso se seu usuário deixar de ser membro.

Adicionar conector remoto no Claude:
- URL: `https://comercial-simpledev.vercel.app/api/delivery/mcp`
- Cabeçalho: `Authorization: Bearer TOKEN_DO_PROJETO`
- Transporte: Streamable HTTP, stateless, respostas JSON (SDK oficial v1).

Esta versão usa cabeçalho fixo, suportado pelos conectores Claude. OAuth por
usuário não foi implementado; não compartilhar o token de um usuário entre
pessoas. Não usar a chave Supabase como credencial do conector.

Ferramentas: obter_contrato, obter_projeto, validar_escopo, salvar_rascunho,
comparar_versoes, enviar_para_revisao e salvar_plano. O servidor valida escopo,
permissões e versões. Aprovação e baseline não são expostas pelo MCP.

`integrations/escopo-simpledev/SKILL.md` contém apenas o trecho MCP a incorporar
na skill original. Aplicar pelo editor oficial e adicionar
`references/crm.md`, `scope.schema.json` e `plan.schema.json`; preservar a skill
e todos os references/assets existentes. Esta pasta é um overlay de atualização,
não uma distribuição completa nem uma edição automática da cópia no Claude.

## GitHub

Configurar no servidor:
- `DELIVERY_GITHUB_TOKEN`: token fine-grained com leitura apenas dos repositórios
  permitidos, permissões Issues, Pull requests, Checks, Deployments e Metadata.
- `DELIVERY_GITHUB_WEBHOOK_SECRET`: segredo dedicado para validar HMAC SHA256.
- `DELIVERY_CRON_SECRET`: segredo diferente para reconciliação agendada.

Vincular `owner/repo` no projeto e números de issues/PRs nas tarefas. O botão
Atualizar evidências consulta o GitHub sem modificar issues/PRs e não altera
o status de execução. Repositórios devem ter token autorizado no servidor.

Webhook JSON: `/api/delivery/github/webhook`, eventos `issues`, `pull_request`,
`check_run`, `check_suite`, `deployment_status`. Entregas só são marcadas como
processadas após sucesso; repetições são ignoradas. Evidências são consultadas
novamente na API, evitando confiar no evento como estado atual. Erros geram
503 para permitir redelivery. GitHub não garante retry automático: configurar
reconciliação periódica em um scheduler autorizado.

GET `/api/delivery/github/reconcile?project=UUID`, com
`Authorization: Bearer DELIVERY_CRON_SECRET`. Agendar por projeto para evitar
limites de execução. Sem parâmetro, aceita até 10 projetos. Sincronização
suporta até 100 tarefas vinculadas por projeto, lê até 100 checks por PR
(sinaliza truncamento) e 5 deployments por SHA. Falha preserva o snapshot
anterior, cuja data permanece visível. Deploys só aparecem quando publicados
na API de deployments do GitHub. Não inferir produção a partir de qualquer deploy.

Não há criação automática de issues nesta versão: criar no GitHub e vincular
os números no plano. Não há scheduler instalado automaticamente nem GitHub App
OAuth. A autenticação inicial é por token restrito no servidor.

## Verificação

`npm run test:delivery`: contrato e piloto, referências, dependências, datas,
assinatura de webhook, migration em PostgreSQL embutido (PGlite), RLS, versões,
idempotência, conflitos e autorização. `npm run delivery:contracts` atualiza
os JSON Schemas do plugin. `npm run build` valida TypeScript/rotas.

Aceite em staging: dois usuários de projetos distintos, importação e conflito
simultâneo, aprovação com pendências rejeitada, conexão Claude real, revogação,
webhook válido/inválido, GitHub real, baseline preservada após nova previsão e
PDF gerado pelo Claude correspondente à versão. Esses testes externos exigem
configuração e acesso do ambiente; testes locais não os substituem.
