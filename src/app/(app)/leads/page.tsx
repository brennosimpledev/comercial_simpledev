import { createClient } from "@/lib/supabase/server";
import { LeadsView, type ReuniaoDoLead } from "@/components/dashboard/LeadsView";
import type { Lead } from "@/types/database";

export const dynamic = "force-dynamic";

// O Supabase devolve no maximo 1000 linhas por consulta: pagina para a
// lista nao parar nos 1000 leads mais recentes.
const PAGINA = 1000;

export default async function LeadsPage() {
  const supabase = await createClient();

  const leads: Lead[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .range(de, de + PAGINA - 1);
    leads.push(...((data ?? []) as Lead[]));
    if (!data || data.length < PAGINA) break;
  }

  // Reunioes de todos os leads (para o icone de reuniao na lista).
  const reunioes: ReuniaoDoLead[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data } = await supabase
      .from("meetings")
      .select("lead_id, starts_at, status")
      .order("starts_at", { ascending: true })
      .range(de, de + PAGINA - 1);
    reunioes.push(...((data ?? []) as ReuniaoDoLead[]));
    if (!data || data.length < PAGINA) break;
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-white">Leads</h1>
      <LeadsView leads={leads} reunioes={reunioes} />
    </div>
  );
}
