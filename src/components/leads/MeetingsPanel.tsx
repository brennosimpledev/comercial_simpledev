"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  scheduleMeeting,
  updateMeetingStatus,
} from "@/app/(app)/leads/meetings";
import type { Meeting, MeetingStatus } from "@/types/database";

const STATUS_CFG: Record<MeetingStatus, { label: string; cls: string }> = {
  agendada: { label: "Agendada", cls: "bg-brand/15 text-brand" },
  realizada: { label: "Realizada", cls: "bg-emerald-500/15 text-emerald-400" },
  furada: { label: "Furada", cls: "bg-amber-500/15 text-amber-400" },
  cancelada: { label: "Cancelada", cls: "bg-red-500/15 text-red-400" },
};

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

function isWeekday(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day >= 1 && day <= 5;
}

function buildSlots(durMin: number) {
  const make = (start: number, end: number) => {
    const arr: string[] = [];
    const last = end - durMin;
    for (let m = start; m <= last; m += 10) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      arr.push(
        `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
      );
    }
    return arr;
  };
  return { morning: make(540, 720), afternoon: make(840, 1080) };
}

export function MeetingsPanel({
  leadId,
  meetings,
  googleConnected,
  hasWhatsapp,
  leadName,
  leadEmail,
}: {
  leadId: string;
  meetings: Meeting[];
  googleConnected: boolean;
  hasWhatsapp: boolean;
  leadName: string;
  leadEmail: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [email, setEmail] = useState(leadEmail ?? "");
  const [notify, setNotify] = useState(true);
  const [dateError, setDateError] = useState("");

  const { morning, afternoon } = useMemo(
    () => buildSlots(durationMin),
    [durationMin]
  );

  function handleDateChange(val: string) {
    setDate(val);
    setDateError(
      val && !isWeekday(val) ? "Selecione um dia útil (seg–sex)." : ""
    );
  }

  function handleDurationChange(val: number) {
    setDurationMin(val);
    const all = [...buildSlots(val).morning, ...buildSlots(val).afternoon];
    if (time && !all.includes(time)) setTime("");
  }

  function agendar() {
    if (!date || !time) return alert("Escolha data e horário.");
    if (!isWeekday(date)) return alert("Selecione um dia útil.");
    startTransition(async () => {
      const res = await scheduleMeeting(leadId, {
        startLocal: `${date}T${time}`,
        durationMin,
        attendeeEmail: email || undefined,
        notifyWhatsapp: notify,
      });
      if (res?.error) alert(res.error);
      else {
        setOpen(false);
        setDate("");
        setTime("");
        setEmail(leadEmail ?? "");
        router.refresh();
      }
    });
  }

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

  if (!googleConnected) {
    return (
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Reuniões</h2>
        <p className="mb-3 text-xs text-slate-400">
          Conecte sua conta Google para agendar reuniões com link do Meet.
        </p>
        <a
          href={`/api/google/connect?next=/leads/${leadId}`}
          className="inline-block rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark"
        >
          Conectar Google Calendar
        </a>
      </div>
    );
  }

  const todayStr = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Reuniões</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-navy hover:bg-brand-dark"
        >
          {open ? "Fechar" : "+ Agendar"}
        </button>
      </div>

      {open && (
        <div className="mb-3 space-y-2 rounded-lg border border-white/10 bg-navy p-3">
          <div>
            <label className="sd-label">Data</label>
            <input
              type="date"
              value={date}
              min={todayStr}
              onChange={(e) => handleDateChange(e.target.value)}
              className="sd-input px-2 py-1.5"
            />
            {dateError && (
              <p className="mt-1 text-xs text-red-400">{dateError}</p>
            )}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="sd-label">Horário</label>
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="sd-input px-2 py-1.5"
              >
                <option value="">Selecione</option>
                {morning.length > 0 && (
                  <optgroup label="Manhã (9h–12h)">
                    {morning.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                )}
                {afternoon.length > 0 && (
                  <optgroup label="Tarde (14h–18h)">
                    {afternoon.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="flex-1">
              <label className="sd-label">Duração</label>
              <select
                value={durationMin}
                onChange={(e) => handleDurationChange(Number(e.target.value))}
                className="sd-input px-2 py-1.5"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hora</option>
              </select>
            </div>
          </div>
          <div>
            <label className="sd-label">Email do lead (convite Google)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className="sd-input px-2 py-1.5"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              disabled={!hasWhatsapp}
              className="h-4 w-4 accent-brand"
            />
            Enviar link no WhatsApp
            {!hasWhatsapp && " (sem WhatsApp)"}
          </label>
          <button
            onClick={agendar}
            disabled={pending || !!dateError}
            className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? "Agendando..." : "Agendar reunião"}
          </button>
        </div>
      )}

      {meetings.length === 0 && !open && (
        <p className="text-xs text-slate-400">Nenhuma reunião.</p>
      )}

      <div className="space-y-2">
        {meetings.map((m) => {
          const sc = STATUS_CFG[m.status] ?? STATUS_CFG.agendada;
          return (
            <div
              key={m.id}
              className="rounded-lg border border-white/10 bg-navy p-2.5 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">
                  {fmt(m.starts_at)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${sc.cls}`}
                >
                  {sc.label}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {m.meet_link && m.status === "agendada" && (
                  <a
                    href={m.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Entrar no Meet
                  </a>
                )}
                {m.status === "agendada" && (
                  <>
                    <button
                      onClick={() => marcar(m.id, "realizada")}
                      disabled={pending}
                      className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                    >
                      Realizada
                    </button>
                    <button
                      onClick={() => marcar(m.id, "furada")}
                      disabled={pending}
                      className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
                    >
                      Furada
                    </button>
                    <button
                      onClick={() => marcar(m.id, "cancelada")}
                      disabled={pending}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
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
