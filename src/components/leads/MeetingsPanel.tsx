"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleMeeting, cancelMeeting } from "@/app/(app)/leads/meetings";
import type { Meeting } from "@/types/database";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function MeetingsPanel({
  leadId,
  meetings,
  googleConnected,
  hasWhatsapp,
}: {
  leadId: string;
  meetings: Meeting[];
  googleConnected: boolean;
  hasWhatsapp: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [titulo, setTitulo] = useState("");
  const [notify, setNotify] = useState(true);

  const ativos = meetings.filter((m) => m.status !== "cancelada");

  function agendar() {
    if (!startLocal) {
      alert("Escolha data e horário.");
      return;
    }
    startTransition(async () => {
      const res = await scheduleMeeting(leadId, {
        startLocal,
        durationMin,
        titulo,
        notifyWhatsapp: notify,
      });
      if (res?.error) alert(res.error);
      else {
        setOpen(false);
        setStartLocal("");
        setTitulo("");
        router.refresh();
      }
    });
  }

  function cancelar(id: string) {
    if (!confirm("Cancelar esta reunião? O evento será removido do Google.")) return;
    startTransition(async () => {
      const res = await cancelMeeting(id);
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
            <label className="sd-label">Data e horário</label>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="sd-input px-2 py-1.5"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="sd-label">Duração</label>
              <select
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="sd-input px-2 py-1.5"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hora</option>
              </select>
            </div>
          </div>
          <div>
            <label className="sd-label">Título (opcional)</label>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Reunião comercial"
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
            Enviar o link no WhatsApp do lead
            {!hasWhatsapp && " (sem WhatsApp)"}
          </label>
          <button
            onClick={agendar}
            disabled={pending}
            className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? "Agendando..." : "Agendar reunião"}
          </button>
        </div>
      )}

      {ativos.length === 0 && !open && (
        <p className="text-xs text-slate-400">Nenhuma reunião agendada.</p>
      )}

      <div className="space-y-2">
        {ativos.map((m) => (
          <div
            key={m.id}
            className="rounded-lg border border-white/10 bg-navy p-2.5 text-sm"
          >
            <div className="font-medium text-white">{fmt(m.starts_at)}</div>
            <div className="mt-1 flex items-center gap-3">
              {m.meet_link ? (
                <a
                  href={m.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-brand hover:underline"
                >
                  🎥 Entrar no Meet
                </a>
              ) : (
                <span className="text-xs text-slate-500">sem link</span>
              )}
              <button
                onClick={() => cancelar(m.id)}
                disabled={pending}
                className="text-xs text-slate-400 hover:text-red-400 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
