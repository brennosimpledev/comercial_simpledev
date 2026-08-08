"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateMeetingStatus } from "@/app/(app)/leads/meetings";
import type { MeetingStatus, MeetingWithLead } from "@/types/database";

const STATUS_CFG: Record<
  MeetingStatus,
  { label: string; cls: string }
> = {
  agendada: { label: "Agendada", cls: "bg-brand/15 text-brand" },
  realizada: { label: "Realizada", cls: "bg-emerald-500/15 text-emerald-400" },
  furada: { label: "Furada", cls: "bg-amber-500/15 text-amber-400" },
  cancelada: { label: "Cancelada", cls: "bg-red-500/15 text-red-400" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "agendada", label: "Agendadas" },
  { key: "realizada", label: "Realizadas" },
  { key: "furada", label: "Furadas" },
  { key: "cancelada", label: "Canceladas" },
];

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function MeetingsList({
  meetings,
}: {
  meetings: MeetingWithLead[];
}) {
  const [filter, setFilter] = useState("todas");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const filtered =
    filter === "todas"
      ? meetings
      : meetings.filter((m) => m.status === filter);

  const counts: Record<string, number> = {
    todas: meetings.length,
    agendada: meetings.filter((m) => m.status === "agendada").length,
    realizada: meetings.filter((m) => m.status === "realizada").length,
    furada: meetings.filter((m) => m.status === "furada").length,
    cancelada: meetings.filter((m) => m.status === "cancelada").length,
  };

  const done = counts.realizada + counts.furada;
  const taxaComparecimento =
    done > 0 ? Math.round((counts.realizada / done) * 100) : null;

  function marcar(id: string, status: "realizada" | "furada" | "cancelada") {
    const msgs: Record<string, string> = {
      realizada: "Marcar como realizada?",
      furada: "Marcar como furada?",
      cancelada: "Cancelar reunião? O evento será removido do Google.",
    };
    if (!confirm(msgs[status])) return;
    startTransition(async () => {
      const res = await updateMeetingStatus(id, status);
      if (res?.error) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-white">Reuniões</h1>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="sd-card p-3 text-center">
          <div className="text-2xl font-bold text-brand">
            {counts.agendada}
          </div>
          <div className="text-xs text-slate-400">Agendadas</div>
        </div>
        <div className="sd-card p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">
            {counts.realizada}
          </div>
          <div className="text-xs text-slate-400">Realizadas</div>
        </div>
        <div className="sd-card p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">
            {counts.furada}
          </div>
          <div className="text-xs text-slate-400">Furadas</div>
        </div>
        <div className="sd-card p-3 text-center">
          <div className="text-2xl font-bold text-white">
            {taxaComparecimento != null ? `${taxaComparecimento}%` : "—"}
          </div>
          <div className="text-xs text-slate-400">Comparecimento</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (filter === f.key
                ? "bg-brand text-navy"
                : "text-slate-300 hover:bg-white/5")
            }
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {/* Lista */}
      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-slate-400">
          Nenhuma reunião{" "}
          {filter !== "todas"
            ? (STATUS_CFG[filter as MeetingStatus]?.label ?? "").toLowerCase()
            : ""}
          .
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((m) => {
          const sc = STATUS_CFG[m.status] ?? STATUS_CFG.agendada;
          const lead = m.leads;
          return (
            <div
              key={m.id}
              className="sd-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">
                    {fmtDate(m.starts_at)}
                  </span>
                  <span className="text-sm text-slate-400">
                    {fmtTime(m.starts_at)} – {fmtTime(m.ends_at)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    {lead.nome}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${sc.cls}`}
                  >
                    {sc.label}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {m.meet_link && m.status === "agendada" && (
                  <a
                    href={m.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20"
                  >
                    Entrar no Meet
                  </a>
                )}
                {m.status === "agendada" && (
                  <>
                    <button
                      onClick={() => marcar(m.id, "realizada")}
                      disabled={pending}
                      className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      Realizada
                    </button>
                    <button
                      onClick={() => marcar(m.id, "furada")}
                      disabled={pending}
                      className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      Furada
                    </button>
                    <button
                      onClick={() => marcar(m.id, "cancelada")}
                      disabled={pending}
                      className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
