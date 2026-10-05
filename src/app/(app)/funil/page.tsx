import { createClient } from "@/lib/supabase/server";
import { FunilBoard } from "@/components/funil/FunilBoard";
import { CLOSER_STAGES, type Lead, type LeadArquivo } from "@/types/database";
import type { ReuniaoResumo } from "@/components/funil/FunilBoard";

export const dynamic = "force-dynamic";

export default async function FunilPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    // "proposta" e o nome antigo da coluna Negociacao.
    .in("estagio", [...CLOSER_STAGES, "proposta"])
    .order("estagio_em", { ascending: true });

  if (error) {
    return (
      <div className="py-12 text-center">
        <h1 className="mb-2 text-xl font-bold text-white">Funil</h1>
        <p className="text-sm text-slate-400">
          Estágios do closer não encontrados. Execute a migration 0015 no SQL
          Editor do Supabase.
        </p>
      </div>
    );
  }

  const leads = (data ?? []) as Lead[];

  // Versao atual de escopo e proposta de cada lead, para o card mostrar em
  // que papel a negociacao esta.
  const { data: arqs } = await supabase
    .from("lead_arquivos")
    .select("id, lead_id, tipo, nome, versao, atual, valor, created_at")
    .eq("atual", true)
    .in("lead_id", leads.length ? leads.map((l) => l.id) : ["sem-leads"]);

  // Historico de reunioes dos leads do funil, para o painel do card.
  const { data: mtgs } = await supabase
    .from("meetings")
    .select("id, lead_id, titulo, starts_at, status, meet_link, gravacao, transcricao")
    .in("lead_id", leads.length ? leads.map((l) => l.id) : ["sem-leads"])
    .order("starts_at", { ascending: false });

  return (
    <FunilBoard
      initialLeads={leads}
      reunioes={(mtgs ?? []) as ReuniaoResumo[]}
      atuais={(arqs ?? []) as Pick<
        LeadArquivo,
        "id" | "lead_id" | "tipo" | "nome" | "versao" | "atual" | "valor" | "created_at"
      >[]}
    />
  );
}
