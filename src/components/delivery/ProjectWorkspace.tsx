"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Scope,
  Plan,
  scopeSchema,
  planSchema,
  clientScope,
  diffScopes,
} from "@/lib/delivery/schema";
import {
  proposePlan,
  implementationDoc,
  progress,
} from "@/lib/delivery/planning";
import { api } from "./ProjectList";
import { Gantt } from "./Gantt";
import { GitHubEvidence } from "./GitHubEvidence";
import { ScopeBrowser } from "./ScopeBrowser";
type Version = { version: number; document: Scope; created_at: string };
type Bundle = {
  project: {
    name: string;
    revision: number;
    scope_status: string;
    approved_version: number | null;
    repository: string | null;
  };
  scopes: Version[];
  plan: { revision: number; document: Plan; baseline: Plan | null } | null;
  events: {
    id: string;
    kind: string;
    version: number;
    created_at: string;
    details: unknown;
  }[];
  github: {
    repository: string;
    evidence: Record<string, unknown>;
    synced_at: string;
  } | null;
  tokens: { id: string; expires_at: string | null; revoked_at: string | null; project_id?: string | null }[];
  members: { user_id: string }[];
  isOwner: boolean;
};
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob(
      [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
      {
        type: typeof value === "string" ? "text/markdown" : "application/json",
      },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const empty: Scope = {
  schemaVersion: 1,
  title: "Novo escopo",
  objective: "Descreva o objetivo",
  sources: [],
  roles: [{ id: "ADMIN", name: "Administrador" }],
  modules: [{ id: "MOD-01", name: "Módulo principal" }],
  requirements: [
    {
      id: "REQ-001",
      moduleId: "MOD-01",
      roleIds: ["ADMIN"],
      title: "Primeira função",
      description: "Descreva o comportamento",
      inclusion: "included",
      acceptance: [],
      hours: null,
      assumptions: [],
      source: "A definir",
    },
  ],
  decisions: [],
  exclusions: [],
  risks: [],
  planningNotes: [],
};
export function ProjectWorkspace({ id }: { id: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null),
    [tab, setTab] = useState("Escopo"),
    [scopeText, setScopeText] = useState(""),
    [planText, setPlanText] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [taskQuery, setTaskQuery] = useState(""),
    [taskStatus, setTaskStatus] = useState("all");
  async function load() {
    const b = (await api("/api/delivery/projects/" + id)) as Bundle;
    setBundle(b);
    setScopeText(JSON.stringify(b.scopes[0]?.document ?? empty, null, 2));
    setPlanText(b.plan ? JSON.stringify(b.plan.document, null, 2) : "");
  }
  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [id]);
  async function run(fn: () => Promise<unknown>, refresh = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (refresh) await load();
      setNotice("Operação concluída.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const scope = bundle?.scopes[0]?.document,
    view =
      bundle?.scopes.find((v) => v.version === selected)?.document ?? scope;
  const plan = bundle?.plan?.document;
  const write = (
    action: string,
    data: unknown,
    expected = bundle?.project.revision ?? 0,
  ) =>
    api("/api/delivery/projects/" + id, {
      action,
      data,
      expected,
      requestId: crypto.randomUUID(),
    });
  const settings = (data: unknown) =>
    api(`/api/delivery/projects/${id}/settings`, data);
  if (!bundle)
    return (
      <div>
        <h1 className="text-2xl">Projeto</h1>
        <p role="alert">{error || "Carregando…"}</p>
      </div>
    );
  const pct = plan ? progress(plan) : null;
  return (
    <div className="space-y-5">
      <Link href="/projetos" className="text-sm text-brand">
        ← Projetos
      </Link>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{bundle.project.name}</h1>
          <p className="mt-2 text-slate-400">
            Escopo v{bundle.project.revision} ·{" "}
            {
              { draft: "Rascunho", review: "Em revisão", approved: "Aprovado" }[
                bundle.project.scope_status
              ]
            }
            {bundle.project.approved_version &&
              ` · Última aprovação: v${bundle.project.approved_version}`}
          </p>
        </div>
        {pct && tab !== "Escopo" && (
          <div className="rounded-xl border border-white/10 p-3">
            <strong>
              {pct.done}/{pct.total}
            </strong>{" "}
            tarefas validadas
            <p className="text-xs text-slate-400">
              {pct.weighted === null
                ? "Percentual por esforço indisponível: faltam estimativas"
                : `${pct.weighted}% do esforço estimado`}
            </p>
          </div>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-white/10">
        {[
          "Escopo",
          "Planejamento",
          "Gantt",
          "GitHub",
          "Histórico",
          "Conexões",
        ].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${tab === t ? "border-brand text-white" : "border-transparent text-slate-400 hover:text-white"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-xl border border-red-400/30 p-4 text-red-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-300">
          {notice}
        </p>
      )}
      {plan &&
        (tab === "Planejamento" || tab === "Gantt") &&
        bundle.project.approved_version !== null &&
        plan.scopeVersion !== bundle.project.approved_version && (
          <p className="rounded-xl border border-amber-400/30 p-3 text-amber-200">
            O plano ainda referencia o escopo v{plan.scopeVersion}. Revise-o
            contra a nova versão aprovada antes de salvar a execução.
          </p>
        )}
      {tab === "Escopo" && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Escopo do projeto</h2>
              <p className="mt-1 text-sm text-slate-400">
                Abra um módulo para consultar suas funções.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                aria-label="Versão exibida"
                className="rounded-lg border border-white/10 bg-navy-mid px-3 py-2 text-sm"
                value={selected ?? bundle.project.revision}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {bundle.scopes.map((v) => (
                  <option key={v.version} value={v.version}>
                    Versão {v.version}
                  </option>
                ))}
              </select>
              <button
                disabled={
                  busy || !scope || bundle.project.scope_status !== "draft"
                }
                className="sd-btn"
                onClick={() => run(() => write("review", {}))}
              >
                Enviar para revisão
              </button>
            </div>
          </div>
          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm text-slate-400">
              Gerenciar escopo · importar, editar e exportar
            </summary>
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-3">
                <label className="sd-btn cursor-pointer">
                  Importar JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={async (e) => {
                      try {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 2_000_000) throw Error("Limite: 2 MB");
                        const parsed = scopeSchema.parse(
                          JSON.parse(await file.text()),
                        );
                        setScopeText(JSON.stringify(parsed, null, 2));
                        setNotice(
                          "Importado no editor. Revise e salve a versão.",
                        );
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  />
                </label>
                <button
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                  onClick={() => download("escopo-modelo.json", empty)}
                >
                  Baixar modelo
                </button>
                {scope && (
                  <>
                    <button
                      className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                      onClick={() =>
                        download(
                          `escopo-v${bundle.project.revision}-interno.json`,
                          scope,
                        )
                      }
                    >
                      Exportar interno
                    </button>
                    <button
                      className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                      onClick={() =>
                        download(
                          `escopo-v${bundle.project.revision}-cliente.json`,
                          clientScope(scope),
                        )
                      }
                    >
                      Exportar cliente (sem horas)
                    </button>
                  </>
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-brand">
                  Editar JSON do escopo
                </summary>
                <textarea
                  aria-label="JSON do escopo"
                  className="sd-input mt-3 min-h-[400px] font-mono text-xs"
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                />
              </details>
              <div className="flex flex-wrap gap-3">
                <button
                  disabled={busy}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                  onClick={() =>
                    run(() =>
                      write(
                        "save_scope",
                        scopeSchema.parse(JSON.parse(scopeText)),
                      ),
                    )
                  }
                >
                  Salvar nova versão
                </button>
              </div>
            </div>
          </details>
          {bundle.isOwner && bundle.project.scope_status === "review" && (
            <form
              className="grid gap-3 rounded-xl border border-brand/30 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() =>
                  write("approve", {
                    approver: f.get("approver"),
                    evidence: f.get("evidence"),
                  }),
                );
              }}
            >
              <h2>Aprovar versão {bundle.project.revision}</h2>
              <input
                className="sd-input"
                name="approver"
                aria-label="Nome de quem aprovou"
                placeholder="Nome de quem aprovou"
                required
                minLength={3}
              />
              <textarea
                name="evidence"
                aria-label="Evidência da aprovação"
                placeholder="Link ou referência da confirmação do cliente"
                className="sd-input"
                required
                minLength={5}
              />
              <button disabled={busy} className="sd-btn">
                Registrar aprovação desta versão
              </button>
            </form>
          )}
          {view && (
            <ScopeBrowser
              key={selected ?? bundle.project.revision}
              scope={view}
            />
          )}
        </section>
      )}
      {tab === "Planejamento" && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Planejamento e execução</h2>
            <p className="mt-1 text-sm text-slate-400">
              Acompanhe as tarefas e abra uma delas para registrar a execução.
            </p>
          </div>
          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm text-slate-400">
              Gerenciar plano · editar, exportar e fixar cronograma
            </summary>
            <p className="my-4 text-sm text-slate-400">
              Defina responsáveis, critérios, estimativas e datas antes de fixar
              o cronograma original.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                disabled={
                  busy || bundle.project.scope_status !== "approved" || !!plan
                }
                className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                onClick={() =>
                  run(() =>
                    write(
                      "save_plan",
                      proposePlan(scope!, bundle.project.revision),
                      0,
                    ),
                  )
                }
              >
                Gerar plano inicial
              </button>
              {plan && scope && (
                <>
                  <button
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                    onClick={() =>
                      download(
                        "implementacao.md",
                        implementationDoc(
                          bundle.scopes.find(
                            (v) => v.version === plan.scopeVersion,
                          )!.document,
                          plan,
                        ),
                      )
                    }
                  >
                    Baixar documentação
                  </button>
                  <button
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                    onClick={() => download("plano.json", plan)}
                  >
                    Exportar plano
                  </button>
                  <button
                    disabled={
                      busy || !!bundle.plan?.baseline || !bundle.isOwner
                    }
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                    onClick={() =>
                      run(() => {
                        if (
                          plan.tasks.some(
                            (t) =>
                              !t.start ||
                              !t.owner ||
                              !t.hours ||
                              !t.acceptance.length,
                          )
                        )
                          throw Error(
                            "Preencha datas, responsáveis, estimativas e critérios antes de fixar a baseline",
                          );
                        return write("baseline", plan, bundle.plan!.revision);
                      })
                    }
                  >
                    Fixar cronograma original
                  </button>
                </>
              )}
            </div>
            {plan && (
              <details className="rounded-xl border border-white/10 p-4">
                <summary className="cursor-pointer text-brand">
                  Editar planejamento e documentação
                </summary>
                <textarea
                  aria-label="JSON do planejamento"
                  className="sd-input mt-3 min-h-[450px] font-mono text-xs"
                  value={planText}
                  onChange={(e) => setPlanText(e.target.value)}
                />
                <button
                  disabled={busy}
                  className="sd-btn mt-3"
                  onClick={() =>
                    run(() =>
                      write(
                        "save_plan",
                        planSchema.parse(JSON.parse(planText)),
                        bundle.plan!.revision,
                      ),
                    )
                  }
                >
                  Salvar planejamento
                </button>
              </details>
            )}
          </details>
          {!plan && (
            <p className="rounded-xl border border-dashed border-white/15 p-6 text-sm text-slate-400">
              Aprove o escopo e gere o plano inicial em Gerenciar plano.
            </p>
          )}
          {plan && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  aria-label="Buscar tarefas"
                  placeholder="Buscar tarefa, código ou responsável…"
                  className="sd-input flex-1"
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                />
                <select
                  aria-label="Filtrar tarefas por situação"
                  className="sd-input sm:max-w-[190px]"
                  value={taskStatus}
                  onChange={(e) => setTaskStatus(e.target.value)}
                >
                  <option value="all">Todas as situações</option>
                  <option value="todo">A fazer</option>
                  <option value="doing">Em execução</option>
                  <option value="review">Em revisão</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="done">Validado</option>
                </select>
              </div>
              <p role="status" className="text-sm text-slate-400">
                {
                  plan.tasks.filter(
                    (t) =>
                      (taskStatus === "all" || t.status === taskStatus) &&
                      `${t.id} ${t.title} ${t.owner}`
                        .toLocaleLowerCase()
                        .includes(taskQuery.toLocaleLowerCase()),
                  ).length
                }{" "}
                de {plan.tasks.length} tarefas
              </p>
              {(taskQuery || taskStatus !== "all") && (
                <button
                  className="text-sm text-brand"
                  onClick={() => {
                    setTaskQuery("");
                    setTaskStatus("all");
                  }}
                >
                  Limpar filtros
                </button>
              )}
              <div className="space-y-2">
                {plan.tasks
                  .filter(
                    (t) =>
                      (taskStatus === "all" || t.status === taskStatus) &&
                      `${t.id} ${t.title} ${t.owner}`
                        .toLocaleLowerCase()
                        .includes(taskQuery.toLocaleLowerCase()),
                  )
                  .map((t) => (
                    <details
                      key={t.id}
                      className="rounded-xl border border-white/10 p-4"
                    >
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {t.id} · {t.title}
                        </span>
                        <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-slate-300">
                          {
                            {
                              todo: "A fazer",
                              doing: "Em execução",
                              review: "Em revisão",
                              blocked: "Bloqueado",
                              done: "Validado",
                            }[t.status]
                          }
                        </span>
                      </summary>
                      <p className="mt-4 text-sm text-slate-400">
                        {t.owner || "Sem responsável"} · {t.hours ?? "—"} h ·{" "}
                        {t.requirementIds.join(", ") || "Fundação"} ·{" "}
                        {t.start ?? "Sem data"}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Critérios: {t.acceptance.join("; ") || "A definir"}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Dependências: {t.dependencies.join(", ") || "Nenhuma"}
                      </p>
                      <details className="mt-4 text-sm">
                        <summary>Atualizar execução</summary>
                        <form
                          className="mt-3 grid gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            const updated = {
                              ...plan,
                              tasks: plan.tasks.map((x) =>
                                x.id === t.id
                                  ? {
                                      ...x,
                                      status: f.get("status"),
                                      evidence: f.get("evidence"),
                                    }
                                  : x,
                              ),
                            };
                            void run(() =>
                              write(
                                "save_plan",
                                updated,
                                bundle.plan!.revision,
                              ),
                            );
                          }}
                        >
                          <select
                            className="sd-input"
                            name="status"
                            aria-label={"Situação " + t.id}
                            defaultValue={t.status}
                          >
                            <option value="todo">A fazer</option>
                            <option value="doing">Em execução</option>
                            <option value="review">Em revisão</option>
                            <option value="blocked">Bloqueado</option>
                            <option value="done">Validado</option>
                          </select>
                          <textarea
                            className="sd-input"
                            name="evidence"
                            aria-label={"Evidência " + t.id}
                            defaultValue={t.evidence}
                            placeholder="Evidência de QA e aceite"
                          />
                          <button
                            disabled={busy}
                            className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                          >
                            Salvar execução
                          </button>
                        </form>
                      </details>
                    </details>
                  ))}
              </div>
            </>
          )}
        </section>
      )}
      {tab === "Gantt" &&
        (plan ? (
          <Gantt plan={plan} baseline={bundle.plan?.baseline ?? null} />
        ) : (
          <p>Gere o planejamento após aprovar o escopo.</p>
        ))}
      {tab === "GitHub" && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Evidências do GitHub</h2>
            <p className="mt-1 text-sm text-slate-400">
              Consulte issues, pull requests e verificações vinculados às
              tarefas.
            </p>
          </div>
          <details
            open={!bundle.project.repository}
            className="rounded-xl border border-white/10 p-4"
          >
            <summary className="cursor-pointer text-sm text-slate-400">
              Repositório · {bundle.project.repository ?? "Configurar conexão"}
            </summary>
            <form
              className="mt-4 flex flex-col gap-3 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() =>
                  settings({
                    action: "repository",
                    repository: f.get("repository"),
                  }),
                );
              }}
            >
              <input
                className="sd-input"
                aria-label="Repositório GitHub"
                name="repository"
                placeholder="organização/repositório"
                defaultValue={bundle.project.repository ?? ""}
                required
              />
              <button className="sd-btn" disabled={busy || !bundle.isOwner}>
                Vincular
              </button>
            </form>
          </details>
          <button
            className="sd-btn"
            disabled={busy || !bundle.project.repository || !plan}
            onClick={() =>
              run(() => api(`/api/delivery/projects/${id}/github`, {}))
            }
          >
            Atualizar evidências
          </button>
          <p className="text-sm text-slate-400">
            {bundle.github
              ? `Última sincronização: ${new Date(bundle.github.synced_at).toLocaleString("pt-BR")}`
              : "Nenhuma sincronização registrada."}
          </p>
          <GitHubEvidence
            evidence={bundle.github?.evidence ?? {}}
            plan={plan}
          />
          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm text-slate-400">
              Como acompanhar e validar
            </summary>
            <p className="mt-3 text-sm text-slate-400">
              Vincule os números das issues e PRs no planejamento. As evidências
              ajudam a acompanhar o desenvolvimento; a validação da tarefa
              continua sendo registrada pela equipe.
            </p>
          </details>
        </section>
      )}
      {tab === "Histórico" && (
        <section className="space-y-4">
          {bundle.scopes.length > 1 && (
            <details>
              <summary>Comparação das duas últimas versões</summary>
              <pre className="overflow-auto text-xs">
                {JSON.stringify(
                  diffScopes(
                    bundle.scopes[1].document,
                    bundle.scopes[0].document,
                  ),
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          {bundle.events.map((ev) => (
            <div className="rounded-lg border border-white/10 p-3" key={ev.id}>
              {ev.kind} · v{ev.version} ·{" "}
              {new Date(ev.created_at).toLocaleString("pt-BR")}
              <pre className="text-xs">{JSON.stringify(ev.details)}</pre>
            </div>
          ))}
        </section>
      )}
      {tab === "Conexões" && (
        <section className="space-y-4">
          <h2 className="text-xl">Claude / MCP</h2>
          <p>
            Crie uma conexão para sua conta do CRM. Claude poderá listar, criar
            e atualizar projetos aos quais seu usuário tem acesso. A conexão
            permanece ativa até você revogá-la. No Claude, configure um único
            conector remoto com o endereço abaixo e o cabeçalho Authorization:
            Bearer TOKEN.
          </p>
          <code className="block break-all">
            {typeof window !== "undefined" ? window.location.origin : ""}
            /api/delivery/mcp
          </code>
          <button
            className="sd-btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await settings({ action: "token" });
                setToken(r.token);
              })
            }
          >
            Criar conexão da conta
          </button>
          {token && (
            <div className="rounded border border-brand p-3">
            <p>Copie agora. O token não será exibido novamente; ele vale para os projetos aos quais sua conta tem acesso até ser revogado.</p>
              <input
                aria-label="Token de conexão"
                type="password"
                readOnly
                value={token}
                className="sd-input"
              />
              <button
                className="sd-btn mt-2"
                onClick={() =>
                  navigator.clipboard
                    .writeText(token)
                    .then(() => setNotice("Token copiado."))
                }
              >
                Copiar token
              </button>
              <button className="ml-3" onClick={() => setToken("")}>
                Ocultar
              </button>
            </div>
          )}
          {bundle.tokens.map((t) => (
            <div key={t.id} className="flex gap-4">
              <span>
                {t.project_id ? "Conexão antiga de um projeto" : "Conexão da conta"} · {t.expires_at ? `Expira em ${new Date(t.expires_at).toLocaleDateString("pt-BR")}` : "Sem expiração"} · {t.revoked_at ? "Revogado" : "Ativo"}
              </span>
              <button
                disabled={busy || !!t.revoked_at}
                className="text-brand"
                onClick={() =>
                  run(() => settings({ action: "revoke", tokenId: t.id }))
                }
              >
                Revogar
              </button>
            </div>
          ))}
          {bundle.isOwner && (
            <form
              className="space-y-2 border-t border-white/10 pt-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() =>
                  settings({ action: "member", userId: f.get("userId") }),
                );
              }}
            >
              <h2>Compartilhar com membro interno</h2>
              <input
                className="sd-input"
                name="userId"
                aria-label="ID do usuário interno"
                placeholder="UUID de usuário existente no CRM"
                required
              />
              <button className="sd-btn" disabled={busy}>
                Adicionar membro
              </button>
              <p className="text-xs text-slate-400">
                Membros podem consultar estimativas e editar rascunhos e planos.
                A aprovação permanece com o responsável.
              </p>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
