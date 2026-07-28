"use client";

import { useDroppable } from "@dnd-kit/core";
import { LeadCard } from "./LeadCard";
import { STAGE_LABELS, type Lead, type LeadStage } from "@/types/database";

export function KanbanColumn({
  stage,
  leads,
}: {
  stage: LeadStage;
  leads: Lead[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-700">
          {STAGE_LABELS[stage]}
        </h2>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
          {leads.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={
          "flex min-h-[60vh] flex-col gap-2 rounded-xl p-2 transition " +
          (isOver ? "bg-brand/10 ring-2 ring-brand/40" : "bg-slate-200/50")
        }
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-slate-400">
            Sem leads
          </p>
        )}
      </div>
    </div>
  );
}
