"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleLeadFlag } from "@/app/(app)/leads/actions";
import type { Lead } from "@/types/database";

type Flag = "qualificado" | "sem_resposta" | "desqualificado";

function Toggle({
  label,
  value,
  onChange,
  disabled,
  color = "emerald",
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  color?: "emerald" | "red" | "amber";
}) {
  const on = {
    emerald: "bg-emerald-500",
    red: "bg-red-500",
    amber: "bg-amber-500",
  }[color];
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-200">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={
          "relative h-6 w-11 rounded-full transition disabled:opacity-50 " +
          (value ? on : "bg-slate-300")
        }
      >
        <span
          className={
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " +
            (value ? "left-[22px]" : "left-0.5")
          }
        />
      </button>
    </div>
  );
}

export function LeadFlags({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function set(flag: Flag, value: boolean) {
    startTransition(async () => {
      const res = await toggleLeadFlag(lead.id, flag, value);
      if (res?.error) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <Toggle
        label="Qualificado"
        value={lead.qualificado}
        onChange={(v) => set("qualificado", v)}
        disabled={pending}
        color="emerald"
      />
      <Toggle
        label="Sem resposta"
        value={lead.sem_resposta}
        onChange={(v) => set("sem_resposta", v)}
        disabled={pending}
        color="amber"
      />
      <Toggle
        label="Desqualificado"
        value={lead.desqualificado}
        onChange={(v) => set("desqualificado", v)}
        disabled={pending}
        color="red"
      />
    </div>
  );
}
