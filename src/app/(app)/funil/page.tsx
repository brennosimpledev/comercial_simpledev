import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FunilBoard } from "@/components/funil/FunilBoard";
import { CLOSER_STAGES, type Lead, type LeadArquivo } from "@/types/database";
import type { ReuniaoResumo } from "@/components/funil/FunilBoard";

export const dynamic = "force-dynamic";

export default async function FunilPage() {
  const supabase = await createClient();

  const buscar = (estagios: string[]) =>
    supabase
      .from("leads")
      .select("*")
      .in("estagio", estagios)
      .order("estagio_em", { ascending: true });
  // "proposta" e o nome antigo da coluna Negociacao.
  let { data, error } = await buscar([...CLOSER_STAGES, "proposta"]);
  // Sem a migration 0020 os estagios novos nao existem no banco e a consulta
  // inteira falha; o funil segue com as colunas antigas.
  if (error) {
    ({ data, error } = await buscar(
      [...CLOSER_STAGES, "proposta"].filter((s) => s !== "interesse" && s !== "desqualificado")
    ));
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <h1 className="mb-2 text-xl font-bold text-white">Funil</h1>
        <p className="text-sm text-slate-400">
          Estágios do closer não encontrados. Execute as migrations 0015 e
          0020 no SQL Editor do Supabase.
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
    .select("*")
    .in("lead_id", leads.length ? leads.map((l) => l.id) : ["sem-leads"])
    .order("starts_at", { ascending: false });

  // A conta do Google e da equipe: se existe uma conectada, da para
  // agendar a partir do funil.
  const { data: gacc } = await createAdminClient()
    .from("google_accounts")
    .select("user_id")
    .limit(1)
    .maybeSingle();

  return (
    <FunilBoard
      initialLeads={leads}
      googleConnected={Boolean(gacc)}
      reunioes={(mtgs ?? []) as ReuniaoResumo[]}
      atuais={(arqs ?? []) as Pick<
        LeadArquivo,
        "id" | "lead_id" | "tipo" | "nome" | "versao" | "atual" | "valor" | "created_at"
      >[]}
    />
  );
}
