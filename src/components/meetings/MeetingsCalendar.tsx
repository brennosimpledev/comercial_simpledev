"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  updateMeetingStatus,
  updateMeetingNotes,
} from "@/app/(app)/leads/meetings";
import {
  ORIGIN_LABELS,
  type LeadOrigin,
  type MeetingStatus,
  type MeetingWithLead,
} from "@/types/database";

const STATUS_CFG: Record<
  MeetingStatus,
  { label: string; bg: string; text: string; pill: string }
> = {
  agendada: {
    label: "Agendada",
    bg: "bg-brand/15",
    text: "text-brand",
    pill: "bg-brand",
  },
  realizada: {
    label: "Realizada",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    pill: "bg-emerald-500",
  },
  furada: {
    label: "Furada",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    pill: "bg-amber-500",
  },
  cancelada: {
    label: "Cancelada",
    bg: "bg-red-500/15",
    text: "text-red-400",
    pill: "bg-red-500/60",
  },
};

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const WDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function dKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function meetKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

function calGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const dow = first.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  const days: { date: Date; key: string; cur: boolean }[] = [];
  for (let i = -offset; i < 42 - offset; i++) {
    const d = new Date(year, month, 1 + i);
    days.push({ date: d, key: dKey(d), cur: d.getMonth() === month });
  }
  if (days.length > 35 && days.slice(35).every((d) => !d.cur))
    return days.slice(0, 35);
  return days;
}

export function MeetingsCalendar({
  meetings,
}: {
  meetings: MeetingWithLead[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const now = new Date();
  const [vYear, setVYear] = useState(now.getFullYear());
  const [vMonth, setVMonth] = useState(now.getMonth());
  const [sel, setSel] = useState<MeetingWithLead | null>(null);
  const [resumo, setResumo] = useState("");
  const [transcricao, setTranscricao] = useState("");

  const today = dKey(now);
  const grid = useMemo(() => calGrid(vYear, vMonth), [vYear, vMonth]);

  const byDate = useMemo(() => {
    const m: Record<string, MeetingWithLead[]> = {};
    for (const mt of meetings) {
      const k = meetKey(mt.starts_at);
      (m[k] ??= []).push(mt);
    }
    for (const k of Object.keys(m))
      m[k].sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
    return m;
  }, [meetings]);

  const cnt = {
    agendada: meetings.filter((m) => m.status === "agendada").length,
    realizada: meetings.filter((m) => m.status === "realizada").length,
    furada: meetings.filter((m) => m.status === "furada").length,
  };
  const done = cnt.realizada + cnt.furada;
  const taxa = done > 0 ? Math.round((cnt.realizada / done) * 100) : null;

  useEffect(() => {
    if (!sel) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sel]);

  function prev() {
    if (vMonth === 0) {
      setVMonth(11);
      setVYear((y) => y - 1);
    } else {
      setVMonth((m) => m - 1);
    }
  }
  function next() {
    if (vMonth === 11) {
      setVMonth(0);
      setVYear((y) => y + 1);
    } else {
      setVMonth((m) => m + 1);
    }
  }
  function goToday() {
    const n = new Date();
    setVYear(n.getFullYear());
    setVMonth(n.getMonth());
  }

  function openMeeting(m: MeetingWithLead) {
    setSel(m);
    setResumo(m.resumo ?? "");
    setTranscricao(m.transcricao ?? "");
  }

  function salvar() {
    if (!sel) return;
    startTransition(async () => {
      const res = await updateMeetingNotes(sel.id, { resumo, transcricao });
      if (res?.error) alert(res.error);
      else {
        setSel(null);
        router.refresh();
      }
    });
  }

  function marcar(st: "realizada" | "furada" | "cancelada") {
    if (!sel) return;
    const msgs = {
      realizada: "Marcar como realizada?",
      furada: "Marcar como furada?",
      cancelada: "Cancelar reunião?",
    };
    if (!confirm(msgs[st])) return;
    startTransition(async () => {
      const res = await updateMeetingStatus(sel.id, st);
      if (res?.error) alert(res.error);
      else {
        setSel(null);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-white">Reuniões</h1>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { v: cnt.agendada, l: "Agendadas", c: "text-brand" },
          { v: cnt.realizada, l: "Realizadas", c: "text-emerald-400" },
          { v: cnt.furada, l: "Furadas", c: "text-amber-400" },
          {
            v: taxa != null ? `${taxa}%` : "—",
            l: "Comparecimento",
            c: "text-white",
          },
        ].map((k) => (
          <div key={k.l} className="sd-card p-3 text-center">
            <div className={`text-2xl font-bold ${k.c}`}>{k.v}</div>
            <div className="text-xs text-slate-400">{k.l}</div>
          </div>
        ))}
      </div>

      {/* Navegacao */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={prev}
            className="rounded-lg px-3 py-1.5 text-lg text-slate-300 hover:bg-white/5"
          >
            ‹
          </button>
          <h2 className="min-w-[180px] text-center text-lg font-semibold text-white">
            {MONTHS[vMonth]} {vYear}
          </h2>
          <button
            onClick={next}
            className="rounded-lg px-3 py-1.5 text-lg text-slate-300 hover:bg-white/5"
          >
            ›
          </button>
        </div>
        <button
          onClick={goToday}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
        >
          Hoje
        </button>
      </div>

      {/* Calendario */}
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Header dias da semana */}
          <div className="mb-1 grid grid-cols-7">
            {WDAYS.map((d, i) => (
              <div
                key={d}
                className={`py-2 text-center text-xs font-semibold ${
                  i >= 5 ? "text-slate-600" : "text-slate-400"
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid de dias */}
          <div className="grid grid-cols-7 gap-1">
            {grid.map((day) => {
              const dm = byDate[day.key] ?? [];
              const isToday = day.key === today;
              const wkend =
                day.date.getDay() === 0 || day.date.getDay() === 6;

              return (
                <div
                  key={day.key}
                  className={`min-h-[90px] rounded-lg border p-1.5 ${
                    isToday
                      ? "border-brand/40 bg-brand/5"
                      : day.cur
                        ? "border-white/5 bg-navy-mid"
                        : "border-transparent bg-navy/30"
                  } ${wkend && !isToday ? "opacity-40" : ""}`}
                >
                  <div
                    className={`mb-1 text-xs font-medium ${
                      isToday
                        ? "text-brand"
                        : day.cur
                          ? "text-slate-300"
                          : "text-slate-600"
                    }`}
                  >
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dm.map((m) => {
                      const sc = STATUS_CFG[m.status] ?? STATUS_CFG.agendada;
                      return (
                        <button
                          key={m.id}
                          onClick={() => openMeeting(m)}
                          className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white transition hover:brightness-125 ${sc.pill}`}
                        >
                          {fmtTime(m.starts_at)} {m.leads.nome.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="mt-3 flex flex-wrap gap-3">
        {(
          ["agendada", "realizada", "furada", "cancelada"] as MeetingStatus[]
        ).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_CFG[s].pill}`}
            />
            {STATUS_CFG[s].label}
          </div>
        ))}
      </div>

      {/* Modal detalhe */}
      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSel(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-navy-mid p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-white">
                  {sel.titulo ?? sel.leads.nome}
                </h3>
                <p className="text-sm text-slate-400">
                  {new Date(sel.starts_at).toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  {fmtTime(sel.starts_at)} – {fmtTime(sel.ends_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CFG[sel.status]?.bg} ${STATUS_CFG[sel.status]?.text}`}
                >
                  {STATUS_CFG[sel.status]?.label}
                </span>
                <button
                  onClick={() => setSel(null)}
                  className="text-lg leading-none text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Dados do lead */}
            <div className="mb-4 rounded-lg border border-white/5 bg-navy p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Dados do Lead
              </h4>
              <div className="space-y-1.5 text-sm">
                <Row label="Nome">
                  <Link
                    href={`/leads/${sel.leads.id}`}
                    className="text-brand hover:underline"
                    onClick={() => setSel(null)}
                  >
                    {sel.leads.nome}
                  </Link>
                </Row>
                {sel.leads.email && (
                  <Row label="Email">{sel.leads.email}</Row>
                )}
                {sel.leads.whatsapp && (
                  <Row label="WhatsApp">{sel.leads.whatsapp}</Row>
                )}
                {sel.leads.origem && (
                  <Row label="Origem">
                    {ORIGIN_LABELS[sel.leads.origem as LeadOrigin] ??
                      sel.leads.origem}
                  </Row>
                )}
              </div>
            </div>

            {/* Link Meet */}
            {sel.meet_link && (
              <div className="mb-4">
                <a
                  href={sel.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark"
                >
                  Entrar no Google Meet
                </a>
              </div>
            )}

            {/* Resumo SDR */}
            <div className="mb-3">
              <label className="sd-label">Resumo do SDR</label>
              <textarea
                value={resumo}
                onChange={(e) => setResumo(e.target.value)}
                rows={3}
                placeholder="Como foi a reunião..."
                className="sd-input px-2 py-1.5"
              />
            </div>

            {/* Transcricao */}
            <div className="mb-4">
              <label className="sd-label">Transcrição / Anotações</label>
              <textarea
                value={transcricao}
                onChange={(e) => setTranscricao(e.target.value)}
                rows={4}
                placeholder="Anotações detalhadas da reunião..."
                className="sd-input px-2 py-1.5"
              />
            </div>

            {/* Acoes */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={salvar}
                disabled={pending}
                className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-60"
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
              {sel.status === "agendada" && (
                <>
                  <button
                    onClick={() => marcar("realizada")}
                    disabled={pending}
                    className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    Realizada
                  </button>
                  <button
                    onClick={() => marcar("furada")}
                    disabled={pending}
                    className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
                  >
                    Furada
                  </button>
                  <button
                    onClick={() => marcar("cancelada")}
                    disabled={pending}
                    className="rounded-lg bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">{children}</span>
    </div>
  );
}
