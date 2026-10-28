"use client";
import { useState } from "react";
import { Plan } from "@/lib/delivery/schema";
export function Gantt({
  plan,
  baseline,
}: {
  plan: Plan;
  baseline: Plan | null;
}) {
  const [query, setQuery] = useState("");
  const [showBaseline, setShowBaseline] = useState(true);
  const scheduled = plan.tasks.filter((t) => t.start && t.end),
    dates = scheduled.flatMap((t) => [t.start!, t.end!]);
  const old = baseline?.tasks.filter((t) => t.start && t.end) ?? [];
  dates.push(...old.flatMap((t) => [t.start!, t.end!]));
  if (!scheduled.length)
    return (
      <p className="text-slate-400">
        Sem datas planejadas. Defina responsáveis, dependências e períodos no
        plano para visualizar o Gantt.
      </p>
    );
  const min = Math.min(...dates.map(Date.parse)),
    max = Math.max(...dates.map(Date.parse)),
    span = max - min + 86400000;
  const bar = (start: string, end: string) => ({
    left: `${(100 * (Date.parse(start) - min)) / span}%`,
    width: `${Math.max(0.5, (100 * (Date.parse(end) - Date.parse(start) + 86400000)) / span)}%`,
  });
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Cronograma do projeto</h2>
        <p className="mt-1 text-sm text-slate-400">
          Período exibido de{" "}
          {new Date(min).toLocaleDateString("pt-BR", { timeZone: "UTC" })} a{" "}
          {new Date(max).toLocaleDateString("pt-BR", { timeZone: "UTC" })}.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
        <span>{scheduled.length} tarefas com datas</span>
        <span>{plan.tasks.length - scheduled.length} sem datas</span>
        <span>{plan.weeklyCapacity ?? "—"} h/semana</span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          aria-label="Buscar no cronograma"
          placeholder="Buscar tarefa ou responsável…"
          className="sd-input flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {baseline && (
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={showBaseline}
              onChange={(e) => setShowBaseline(e.target.checked)}
            />
            Comparar com original
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span>Azul · Previsão</span>
        <span>Verde · Validado</span>
        <span>Vermelho · Bloqueado</span>
        {baseline && showBaseline && <span>Cinza · Original</span>}
      </div>
      <p className="text-xs text-slate-400 md:hidden">
        Deslize o cronograma para consultar todo o período.
      </p>
      <div
        role="region"
        aria-label="Cronograma de tarefas"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-white/10 p-4 focus-visible:outline focus-visible:outline-brand"
      >
        <div className="min-w-[750px]">
          <div className="mb-3 flex justify-between text-xs text-slate-400">
            <span>{new Date(min).toISOString().slice(0, 10)}</span>
            <span>Período planejado</span>
            <span>{new Date(max).toISOString().slice(0, 10)}</span>
          </div>
          {scheduled
            .filter((t) =>
              `${t.id} ${t.title} ${t.owner}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((t) => {
              const b = old.find((x) => x.id === t.id);
              return (
                <div
                  className="grid grid-cols-[250px_1fr] gap-4 border-t border-white/10 py-3"
                  key={t.id}
                >
                  <div>
                    <p className="text-sm">{t.title}</p>
                    <p className="mt-1 text-xs text-slate-300">
                      {
                        {
                          todo: "A fazer",
                          doing: "Em execução",
                          review: "Em revisão",
                          blocked: "Bloqueado",
                          done: "Validado",
                        }[t.status]
                      }
                    </p>
                    <p className="text-xs text-slate-400">
                      {t.owner || "Sem responsável"} · {t.start} → {t.end}
                    </p>
                  </div>
                  <div className="relative h-10 bg-white/5">
                    {b && showBaseline && (
                      <div
                        title={`Original: ${b.start} → ${b.end}`}
                        className="absolute top-7 h-2 rounded bg-slate-500"
                        style={bar(b.start!, b.end!)}
                      />
                    )}
                    <div
                      title={t.status}
                      className={`absolute top-1 h-5 rounded ${t.status === "done" ? "bg-emerald-500" : t.status === "blocked" ? "bg-red-400" : "bg-brand"}`}
                      style={bar(t.start!, t.end!)}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      {query &&
        !scheduled.some((t) =>
          `${t.id} ${t.title} ${t.owner}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        ) && (
          <p role="status" className="text-sm text-slate-400">
            Nenhuma tarefa encontrada. Altere a busca.
          </p>
        )}
      <details className="rounded-xl border border-white/10 p-4">
        <summary className="cursor-pointer text-sm text-slate-400">
          Sobre o cronograma e tarefas sem datas
        </summary>
        <p className="mt-3 text-sm text-slate-400">
          {plan.tasks.length - scheduled.length} tarefas ainda sem datas.
          Capacidade: {plan.weeklyCapacity ?? "não definida"} h/semana. Datas
          são propostas pelo planejamento, não calculadas automaticamente.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-400">
          {plan.tasks
            .filter((t) => !t.start || !t.end)
            .map((t) => (
              <li key={t.id}>
                {t.id} · {t.title}
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
