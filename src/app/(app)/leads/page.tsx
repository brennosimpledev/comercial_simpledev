import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  ORIGIN_LABELS,
  STAGE_LABELS,
  type Lead,
} from "@/types/database";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  const leads = (data ?? []) as Lead[];

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500">{leads.length} no total</p>
        </div>
        <Link
          href="/leads/novo"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          + Novo lead
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Contato</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium">Estágio</th>
              <th className="px-4 py-3 font-medium">Entrada</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {lead.nome}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{lead.email ?? "—"}</div>
                  <div className="text-xs text-slate-400">
                    {lead.whatsapp ?? ""}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {ORIGIN_LABELS[lead.origem]}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {STAGE_LABELS[lead.estagio]}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {formatDate(lead.created_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  Nenhum lead ainda. Eles aparecem aqui automaticamente
                  quando a LP dispara o webhook.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
