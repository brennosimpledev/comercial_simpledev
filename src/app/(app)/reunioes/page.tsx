import { createClient } from "@/lib/supabase/server";
import { MeetingsCalendar } from "@/components/meetings/MeetingsCalendar";
import type { MeetingWithLead } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("meetings")
    .select("*, leads(id, nome, email, whatsapp, origem, anotacoes)")
    .order("starts_at", { ascending: false });

  if (error) {
    return (
      <div className="py-12 text-center">
        <h1 className="mb-2 text-xl font-bold text-white">Reuniões</h1>
        <p className="text-sm text-slate-400">
          Tabela de reuniões não encontrada. Execute a migration 0004 no
          Supabase SQL Editor.
        </p>
      </div>
    );
  }

  const meetings = (data ?? []) as MeetingWithLead[];

  return <MeetingsCalendar meetings={meetings} />;
}
