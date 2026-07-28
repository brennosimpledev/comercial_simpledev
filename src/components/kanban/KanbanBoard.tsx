"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./KanbanColumn";
import { updateLeadStage } from "@/app/(app)/leads/actions";
import { STAGE_ORDER, type Lead, type LeadStage } from "@/types/database";

export function KanbanBoard({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);

  // Exige um pequeno arraste antes de iniciar o drag, para nao
  // conflitar com o clique no link "Abrir".
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const byStage = useMemo(() => {
    const map: Record<LeadStage, Lead[]> = {
      novo: [],
      sdr: [],
      reuniao_marcada: [],
      proposta: [],
      fechado: [],
      perdido: [],
    };
    for (const lead of leads) map[lead.estagio].push(lead);
    return map;
  }, [leads]);

  async function handleDragEnd(event: DragEndEvent) {
    const leadId = String(event.active.id);
    const target = event.over?.id as LeadStage | undefined;
    if (!target) return;

    const current = leads.find((l) => l.id === leadId);
    if (!current || current.estagio === target) return;

    const previous = leads;
    // Update otimista.
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, estagio: target } : l))
    );

    const res = await updateLeadStage(leadId, target);
    if (res?.error) {
      // Reverte em caso de erro.
      setLeads(previous);
      alert(res.error);
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGE_ORDER.map((stage) => (
          <KanbanColumn key={stage} stage={stage} leads={byStage[stage]} />
        ))}
      </div>
    </DndContext>
  );
}
