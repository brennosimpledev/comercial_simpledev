"use client";
import { useState } from "react";
import type { Scope } from "@/lib/delivery/schema";
const labels = {
  included: "Incluído",
  pending: "A confirmar",
  optional: "Opcional",
  excluded: "Excluído",
};
const tones = {
  included: "text-emerald-300 bg-emerald-400/10",
  pending: "text-amber-200 bg-amber-400/10",
  optional: "text-sky-300 bg-sky-400/10",
  excluded: "text-slate-400 bg-white/5",
};
export function ScopeBrowser({ scope }: { scope: Scope }) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [open, setOpen] = useState<string | null>(null),
    [decisionsOpen, setDecisionsOpen] = useState(false);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const matches = scope.requirements.filter(
    (r) =>
      (filter === "all" || r.inclusion === filter) &&
      normalize(
        `${r.id} ${r.title} ${r.description} ${scope.modules.find((m) => m.id === r.moduleId)?.name}`,
      ).includes(normalize(query)),
  );
  const modules = scope.modules.filter((m) =>
    matches.some((r) => r.moduleId === m.id),
  );
  const pending = scope.decisions.filter((d) => !d.answer).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-400">
        <span>
          <strong className="text-slate-100">{scope.modules.length}</strong>{" "}
          módulos
        </span>
        <span>
          <strong className="text-slate-100">
            {scope.requirements.length}
          </strong>{" "}
          funções
        </span>
        {pending > 0 && (
          <a
            href="#scope-decisions"
            onClick={() => setDecisionsOpen(true)}
            className="text-amber-200 underline-offset-4 hover:underline"
          >
            {pending} decisões pendentes ↓
          </a>
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          aria-label="Buscar funções ou módulos"
          className="sd-input flex-1"
          placeholder="Buscar função, módulo ou código…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filtrar situação"
          className="sd-input sm:max-w-[190px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todas as situações</option>
          {Object.entries(labels).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {(query || filter !== "all") && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span role="status">{matches.length} funções encontradas</span>
          <button
            className="text-brand hover:underline"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Limpar filtros
          </button>
        </div>
      )}
      <div className="grid items-start gap-3 md:grid-cols-2">
        {modules.map((m) => {
          const rows = matches.filter((r) => r.moduleId === m.id),
            expanded = open === m.id;
          return (
            <section
              key={m.id}
              className={`min-w-0 overflow-hidden rounded-xl border ${expanded ? "border-brand/40 bg-white/[0.025] md:col-span-2" : "border-white/10"}`}
            >
              <h3>
                <button
                  aria-expanded={expanded}
                  aria-controls={`module-${m.id}`}
                  onClick={() => setOpen(expanded ? null : m.id)}
                  className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <span aria-hidden className="text-slate-500">
                    {expanded ? "−" : "+"}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {m.name}
                  </span>
                  <span className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-400">
                    {rows.length} {rows.length === 1 ? "função" : "funções"}
                  </span>
                </button>
              </h3>
              {expanded && (
                <div
                  id={`module-${m.id}`}
                  className="border-t border-white/10 px-4"
                >
                  {rows.map((r) => (
                    <details
                      key={r.id}
                      className="border-b border-white/5 last:border-0"
                    >
                      <summary className="grid grid-cols-[minmax(0,1fr)_auto] cursor-pointer list-none items-start gap-x-3 gap-y-2 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand sm:flex">
                        <span className="col-span-2 mt-0.5 text-xs text-slate-500">
                          {r.id}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">{r.title}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${tones[r.inclusion]}`}
                        >
                          {labels[r.inclusion]}
                        </span>
                        <span aria-hidden className="hidden text-slate-500 sm:block">
                          ⌄
                        </span>
                      </summary>
                      <div className="space-y-3 pb-5 pl-2 text-sm text-slate-400">
                        {r.description !== r.title && <p>{r.description}</p>}
                        <p>
                          Estimativa:{" "}
                          {r.hours === null ? "a definir" : `${r.hours} h`} ·
                          Perfis:{" "}
                          {r.roleIds
                            .map(
                              (id) =>
                                scope.roles.find((role) => role.id === id)
                                  ?.name ?? id,
                            )
                            .join(", ") || "a definir"}
                        </p>
                        <div>
                          <p className="mb-1 font-medium text-slate-300">
                            Critérios de aceite
                          </p>
                          {r.acceptance.length ? (
                            <ul className="list-inside list-disc space-y-1">
                              {r.acceptance.map((x, i) => (
                                <li key={i}>{x}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>A definir no planejamento.</p>
                          )}
                        </div>
                        {r.assumptions.length > 0 && (
                          <p>Premissas: {r.assumptions.join("; ")}</p>
                        )}
                        <p className="text-xs">Fonte: {r.source}</p>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!modules.length && (
        <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
          <p>Nenhuma função encontrada.</p>
          <p className="mt-2 text-sm text-slate-400">
            Tente outro termo ou limpe os filtros.
          </p>
        </div>
      )}
      <details className="rounded-xl border border-white/10 p-4">
        <summary className="cursor-pointer text-sm text-slate-300">
          Contexto e objetivo do projeto
        </summary>
        <h3 className="mb-2 mt-4 font-medium">{scope.title}</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-400">
          {scope.objective}
        </p>
      </details>
      <section id="scope-decisions" className="scroll-mt-24">
        <details open={decisionsOpen} onToggle={(e) => setDecisionsOpen(e.currentTarget.open)} className="rounded-xl border border-white/10 p-4">
          <summary className="cursor-pointer text-sm text-slate-300">
            Decisões e limites{" "}
            {pending > 0 && (
              <span className="ml-2 text-amber-200">· {pending} pendentes</span>
            )}
          </summary>
          <div className="mt-4 space-y-5">
            {scope.decisions.map((d) => (
              <div key={d.id}>
                <p className="text-sm font-medium">{d.question}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {d.answer ?? `A decidir: ${d.options.join(" / ")}`}
                </p>
              </div>
            ))}
            {[
              ["Riscos", scope.risks],
              ["Fora do escopo", scope.exclusions],
            ].map(([title, items]) => (
              <div key={title as string}>
                <h3 className="mb-2 text-sm font-medium">{title}</h3>
                <ul className="list-inside list-disc space-y-2 text-sm text-slate-400">
                  {(items as string[]).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>
  );
}
