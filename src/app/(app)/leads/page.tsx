import { createClient } from "@/lib/supabase/server";
import { LeadsView } from "@/components/dashboard/LeadsView";
import type { Lead } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();

  const [{ data: leads }, { data: outbound }] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase
      .from("lead_messages")
      .select("lead_id")
      .eq("direction", "outbound"),
  ]);

  const respondedIds = Array.from(
    new Set((outbound ?? []).map((m) => m.lead_id as string))
  );

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-white">Leads</h1>
      <LeadsView leads={(leads ?? []) as Lead[]} respondedIds={respondedIds} />
    </div>
  );
}
