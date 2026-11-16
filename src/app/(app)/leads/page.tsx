import { createClient } from "@/lib/supabase/server";
import { LeadsView } from "@/components/dashboard/LeadsView";
import type { Lead } from "@/types/database";

export const dynamic = "force-dynamic";

// O Supabase devolve no maximo 1000 linhas por consulta. Sem paginar, a
// lista de mensagens enviadas parava nas 1000 mais antigas e o "Respondido"
// zerava para os leads novos.
const PAGINA = 1000;

export default async function LeadsPage() {
  const supabase = await createClient();

  async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>) {
    const linhas: T[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data } = await consulta(de, de + PAGINA - 1);
      linhas.push(...(data ?? []));
      if (!data || data.length < PAGINA) break;
    }
    return linhas;
  }

  const [leads, outbound] = await Promise.all([
    todas<Lead>((de, ate) =>
      supabase.from("leads").select("*").order("created_at", { ascending: false }).range(de, ate)
    ),
    todas<{ lead_id: string }>((de, ate) =>
      supabase
        .from("lead_messages")
        .select("lead_id")
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .range(de, ate)
    ),
  ]);

  const respondedIds = Array.from(new Set(outbound.map((m) => m.lead_id)));

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-white">Leads</h1>
      <LeadsView leads={leads} respondedIds={respondedIds} />
    </div>
  );
}
