import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import type { Lead } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Pipeline</h1>
          <p className="text-sm text-slate-500">
            Arraste os cards para mudar o estágio.
          </p>
        </div>
        <Link
          href="/leads/novo"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          + Novo lead
        </Link>
      </div>

      <KanbanBoard initialLeads={(leads ?? []) as Lead[]} />
    </div>
  );
}
