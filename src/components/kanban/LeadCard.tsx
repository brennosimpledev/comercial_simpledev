"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { ORIGIN_LABELS, type Lead } from "@/types/database";

const ORIGIN_STYLES: Record<string, string> = {
  google_ads: "bg-blue-100 text-blue-700",
  meta_ads: "bg-indigo-100 text-indigo-700",
  indicacao: "bg-emerald-100 text-emerald-700",
  organico: "bg-slate-100 text-slate-600",
  outro: "bg-slate-100 text-slate-600",
};

export function LeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: lead.id });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{lead.nome}</p>
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium " +
            (ORIGIN_STYLES[lead.origem] ?? ORIGIN_STYLES.outro)
          }
        >
          {ORIGIN_LABELS[lead.origem]}
        </span>
      </div>

      {lead.necessidade && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">
          {lead.necessidade}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {lead.orcamento ?? "—"}
        </span>
        <Link
          href={`/leads/${lead.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-xs font-medium text-brand hover:underline"
        >
          Abrir
        </Link>
      </div>
    </div>
  );
}
