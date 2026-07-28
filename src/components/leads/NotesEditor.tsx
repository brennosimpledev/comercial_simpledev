"use client";

import { useState, useTransition } from "react";
import { updateLeadNotes } from "@/app/(app)/leads/actions";

export function NotesEditor({
  leadId,
  initial,
}: {
  leadId: string;
  initial: string | null;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      const res = await updateLeadNotes(leadId, value);
      if (!res?.error) setSaved(true);
    });
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        rows={6}
        placeholder="Anotações internas sobre o lead..."
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Salvando..." : "Salvar anotações"}
        </button>
        {saved && (
          <span className="text-xs text-emerald-600">Salvo ✓</span>
        )}
      </div>
    </div>
  );
}
