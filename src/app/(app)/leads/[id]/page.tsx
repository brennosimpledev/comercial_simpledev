import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotesEditor } from "@/components/leads/NotesEditor";
import {
  ORIGIN_LABELS,
  STAGE_LABELS,
  type Lead,
} from "@/types/database";

export const dynamic = "force-dynamic";

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (!data) notFound();
  const lead = data as Lead;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <Link href="/leads" className="text-sm text-slate-500 hover:underline">
          ← Voltar
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">{lead.nome}</h1>
          <span className="rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand">
            {STAGE_LABELS[lead.estagio]}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Contato & qualificação
          </h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="E-mail" value={lead.email} />
            <Field label="WhatsApp" value={lead.whatsapp} />
            <Field label="Origem" value={ORIGIN_LABELS[lead.origem]} />
            <Field label="Orçamento" value={lead.orcamento} />
            <Field label="Necessidade" value={lead.necessidade} />
            <Field label="Prazo / início" value={lead.prazo} />
            <Field label="Relação com projeto" value={lead.relacao_projeto} />
            <Field label="Status" value={lead.status} />
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Rastreamento
          </h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="utm_source" value={lead.utm_source} />
            <Field label="utm_medium" value={lead.utm_medium} />
            <Field label="utm_campaign" value={lead.utm_campaign} />
            <Field label="utm_term" value={lead.utm_term} />
            <Field label="utm_content" value={lead.utm_content} />
            <Field label="gclid" value={lead.gclid} />
            <Field label="Referral" value={lead.referral_source} />
            <Field label="Dispositivo" value={lead.dispositivo} />
            <Field
              label="Localização"
              value={[lead.cidade, lead.regiao, lead.pais]
                .filter(Boolean)
                .join(", ")}
            />
            <Field
              label="URL de conversão"
              value={lead.url_conversao}
            />
          </dl>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Anotações
        </h2>
        <NotesEditor leadId={lead.id} initial={lead.anotacoes} />
      </section>
    </div>
  );
}
