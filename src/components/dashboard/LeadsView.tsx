"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LeadsChart } from "./LeadsChart";
import { deleteLead } from "@/app/(app)/leads/actions";
import {
  ORIGIN_LABELS,
  STAGE_LABELS,
  type Lead,
  type LeadOrigin,
} from "@/types/database";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl bg-brand px-4 py-3 text-center text-white">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs opacity-90">{label}</div>
    </div>
  );
}

function StatusIcon({ lead }: { lead: Lead }) {
  if (lead.desqualificado)
    return <span title="Desqualificado">👎</span>;
  if (lead.qualificado) return <span title="Qualificado">👍</span>;
  if (lead.sem_resposta) return <span title="Sem resposta">🛌</span>;
  return <span className="text-slate-300">—</span>;
}

export function LeadsView({
  leads,
  respondedIds,
}: {
  leads: Lead[];
  respondedIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 86400_000);
  const [from, setFrom] = useState(ymd(weekAgo));
  const [to, setTo] = useState(ymd(today));
  const [origem, setOrigem] = useState<"" | LeadOrigin>("");

  const responded = useMemo(() => new Set(respondedIds), [respondedIds]);

  const filtered = useMemo(() => {
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T23:59:59");
    return leads.filter((l) => {
      const c = new Date(l.created_at);
      if (c < start || c > end) return false;
      if (origem && l.origem !== origem) return false;
      return true;
    });
  }, [leads, from, to, origem]);

  const kpis = useMemo(() => {
    return {
      leads: filtered.length,
      sdr: filtered.filter((l) => l.estagio === "sdr").length,
      respondido: filtered.filter((l) => responded.has(l.id)).length,
      qualificados: filtered.filter((l) => l.qualificado).length,
      reunioes: filtered.filter((l) => l.estagio === "reuniao_marcada").length,
    };
  }, [filtered, responded]);

  const chartPoints = useMemo(() => {
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    const days: { label: string; value: number }[] = [];
    const counts = new Map<string, number>();
    for (const l of filtered) {
      const key = ymd(new Date(l.created_at));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400_000)) {
      const key = ymd(d);
      days.push({
        label: d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
        value: counts.get(key) ?? 0,
      });
    }
    return days;
  }, [filtered, from, to]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [filtered]
  );

  function handleDelete(id: string, nome: string) {
    if (!confirm(`Excluir o lead "${nome}"? Essa ação não pode ser desfeita.`))
      return;
    startTransition(async () => {
      const res = await deleteLead(id);
      if (res?.error) alert(res.error);
      else router.refresh();
    });
  }

  const inputCls =
    "rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-center text-sm font-semibold text-slate-500">
          Leads
        </h2>
        <LeadsChart points={chartPoints} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Kpi label="Leads" value={kpis.leads} />
        <Kpi label="SDR" value={kpis.sdr} />
        <Kpi label="Respondido" value={kpis.respondido} />
        <Kpi label="Qualificados" value={kpis.qualificados} />
        <Kpi label="Reuniões" value={kpis.reunioes} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={origem}
          onChange={(e) => setOrigem(e.target.value as "" | LeadOrigin)}
          className={inputCls}
        >
          <option value="">Todas as origens</option>
          {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={inputCls}
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={inputCls}
        />
        <Link
          href="/leads/novo"
          className="rounded-full bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
        >
          + Lead
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {sorted.map((lead) => (
          <div
            key={lead.id}
            className={
              "flex items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 " +
              (lead.qualificado ? "bg-amber-50" : "hover:bg-slate-50")
            }
          >
            <div className="w-48 shrink-0 font-medium text-slate-900">
              <Link href={`/leads/${lead.id}`} className="hover:underline">
                {lead.nome}
              </Link>
            </div>
            <div className="w-36 shrink-0 text-slate-600">
              {lead.whatsapp ?? "—"}
            </div>
            <div className="hidden flex-1 truncate text-slate-500 md:block">
              {lead.email ?? ""}
            </div>
            <div className="w-32 shrink-0 text-slate-500">
              {fmtDateTime(lead.created_at)}
            </div>
            <div className="w-28 shrink-0 text-slate-600">
              {ORIGIN_LABELS[lead.origem]}
            </div>
            <div className="w-20 shrink-0 text-center text-slate-500">
              {STAGE_LABELS[lead.estagio]}
            </div>
            <div className="w-8 shrink-0 text-center text-base">
              <StatusIcon lead={lead} />
            </div>
            <div className="flex w-16 shrink-0 items-center justify-end gap-2">
              <Link
                href={`/leads/${lead.id}`}
                title="Abrir conversa"
                className="text-slate-400 hover:text-brand"
              >
                💬
              </Link>
              <button
                onClick={() => handleDelete(lead.id, lead.nome)}
                disabled={pending}
                title="Excluir"
                className="text-slate-400 hover:text-red-500 disabled:opacity-50"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nenhum lead no período/origem selecionado.
          </p>
        )}
      </div>
    </div>
  );
}
