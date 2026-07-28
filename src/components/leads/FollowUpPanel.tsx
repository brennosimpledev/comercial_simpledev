"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendFollowUpNow,
  skipFollowUp,
  toggleLeadFlag,
} from "@/app/(app)/leads/actions";
import type { FollowUp } from "@/types/database";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FollowUpPanel({
  leadId,
  followUps,
  botPausado,
  hasWhatsapp,
}: {
  leadId: string;
  followUps: FollowUp[];
  botPausado: boolean;
  hasWhatsapp: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string } | undefined>) {
    startTransition(async () => {
      const res = await fn();
      if (res?.error) alert(res.error);
      else router.refresh();
    });
  }

  const pendentes = followUps.filter((f) => f.status === "pendente");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Follow up recomendado
        </h3>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Pausar bot
          <input
            type="checkbox"
            checked={botPausado}
            disabled={pending}
            onChange={(e) =>
              run(() => toggleLeadFlag(leadId, "bot_pausado", e.target.checked))
            }
            className="h-4 w-4 accent-brand"
          />
        </label>
      </div>

      {pendentes.length === 0 && (
        <p className="text-sm text-slate-400">
          Nenhum follow-up pendente para este lead.
        </p>
      )}

      <div className="space-y-3">
        {pendentes.map((f) => (
          <div
            key={f.id}
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                {f.titulo ?? "Follow-up"}
              </span>
              <span>agendado {fmt(f.scheduled_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {f.body}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => run(() => sendFollowUpNow(f.id))}
                disabled={pending || !hasWhatsapp}
                title={hasWhatsapp ? "" : "Lead sem WhatsApp"}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Enviar agora
              </button>
              <button
                onClick={() => run(() => skipFollowUp(f.id))}
                disabled={pending}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Pular
              </button>
            </div>
          </div>
        ))}
      </div>

      {botPausado && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Bot pausado — os follow-ups não serão enviados automaticamente.
        </p>
      )}
    </div>
  );
}
