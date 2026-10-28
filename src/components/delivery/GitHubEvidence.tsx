"use client";
import type { Plan } from "@/lib/delivery/schema";
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const state = (v: unknown) =>
  ({
    open: "Aberto",
    closed: "Fechado",
    success: "Sucesso",
    failure: "Falhou",
    pending: "Pendente",
    completed: "Concluído",
    in_progress: "Em andamento",
    queued: "Na fila",
    neutral: "Neutro",
    skipped: "Ignorado",
    cancelled: "Cancelado",
    timed_out: "Tempo esgotado",
    action_required: "Ação necessária",
  })[String(v)] ?? String(v ?? "Sem resultado");
function EvidenceLink({
  item,
  label,
}: {
  item: Record<string, unknown>;
  label: string;
}) {
  const url =
    typeof item.url === "string" && item.url.startsWith("https://github.com/")
      ? item.url
      : null;
  return url ? (
    <a
      className="text-brand hover:underline"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      {label} ↗
    </a>
  ) : (
    <span>{label}</span>
  );
}
export function GitHubEvidence({
  evidence,
  plan,
}: {
  evidence: Record<string, unknown>;
  plan?: Plan;
}) {
  const entries = Object.entries(evidence);
  if (!entries.length)
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-8 text-center">
        <p>Nenhuma evidência disponível.</p>
        <p className="mt-2 text-sm text-slate-400">
          Vincule um repositório e as issues ou PRs das tarefas; depois atualize
          as evidências.
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        {entries.length}{" "}
        {entries.length === 1
          ? "tarefa com evidências"
          : "tarefas com evidências"}{" "}
        · abra uma tarefa para consultar os detalhes.
      </p>
      {entries.map(([id, value]) => {
        const e = record(value),
          issue = record(e.issue),
          pull = record(e.pull),
          checks = record(e.checks);
        const runs = Array.isArray(checks.runs) ? checks.runs : [],
          deployments = Array.isArray(e.deployments) ? e.deployments : [];
        return (
          <details key={id} className="rounded-xl border border-white/10 p-4">
            <summary className="flex cursor-pointer list-none flex-wrap justify-between gap-3">
              <span className="min-w-0 flex-1 text-sm font-medium">
                {id} ·{" "}
                {plan?.tasks.find((t) => t.id === id)?.title ??
                  "Tarefa vinculada"}
              </span>
              <span className="text-xs text-slate-400">
                {pull.merged
                  ? "PR integrado"
                  : pull.number
                    ? `PR ${state(pull.state)}`
                    : issue.number
                      ? `Issue ${state(issue.state)}`
                      : "Sem vínculos"}
              </span>
            </summary>
            <div className="mt-4 space-y-4 text-sm">
              {issue.number != null && (
                <p>
                  <EvidenceLink item={issue} label={`Issue #${issue.number}`} />{" "}
                  · {state(issue.state)}
                </p>
              )}
              {pull.number != null && (
                <p>
                  <EvidenceLink item={pull} label={`PR #${pull.number}`} /> ·{" "}
                  {pull.merged ? "Integrado" : state(pull.state)}
                  {pull.draft ? " · Rascunho" : ""}
                </p>
              )}
              <div>
                <h3 className="mb-2 text-slate-300">Verificações</h3>
                {runs.length ? (
                  runs.map((v, i) => {
                    const c = record(v);
                    return (
                      <p key={i} className="py-1 text-slate-400">
                        <EvidenceLink
                          item={c}
                          label={String(c.name ?? "Verificação")}
                        />{" "}
                        · {state(c.conclusion ?? c.status)}
                      </p>
                    );
                  })
                ) : (
                  <p className="text-slate-400">
                    Nenhuma verificação registrada.
                  </p>
                )}
                {checks.truncated === true && (
                  <p className="text-amber-200">
                    Exibindo as primeiras 100 verificações.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-slate-300">Publicações</h3>
                {deployments.length ? (
                  deployments.map((v, i) => {
                    const d = record(v);
                    return (
                      <p key={i} className="text-slate-400">
                        {String(d.environment)} · {state(d.state)}
                      </p>
                    );
                  })
                ) : (
                  <p className="text-slate-400">
                    Nenhuma publicação registrada.
                  </p>
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-slate-400">
                  Dados técnicos
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-black/20 p-3 text-xs">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </details>
            </div>
          </details>
        );
      })}
    </div>
  );
}
