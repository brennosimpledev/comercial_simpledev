import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Conversation } from "@/components/leads/Conversation";
import { LeadFlags } from "@/components/leads/LeadFlags";
import { FollowUpPanel } from "@/components/leads/FollowUpPanel";
import { NotesEditor } from "@/components/leads/NotesEditor";
import {
  ORIGIN_LABELS,
  STAGE_LABELS,
  type FollowUp,
  type Lead,
  type LeadMessage,
} from "@/types/database";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase text-slate-400">{label}</dt>
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

  const [{ data: leadRow }, { data: msgs }, { data: fus }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase
      .from("lead_messages")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("follow_ups")
      .select("*")
      .eq("lead_id", id)
      .order("scheduled_at", { ascending: true }),
  ]);

  if (!leadRow) notFound();
  const lead = leadRow as Lead;
  const messages = (msgs ?? []) as LeadMessage[];
  const followUps = (fus ?? []) as FollowUp[];
  const hasWhatsapp = Boolean(lead.whatsapp);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/leads" className="text-sm text-slate-500 hover:underline">
          ← Voltar
        </Link>
        <span className="rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand">
          {STAGE_LABELS[lead.estagio]}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Coluna de infos */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h1 className="mb-4 text-base font-semibold text-slate-900">
              {lead.nome}
            </h1>
            <dl className="space-y-3">
              <Field label="Telefone" value={lead.whatsapp} />
              <Field label="E-mail" value={lead.email} />
              <Field
                label="Meio de aquisição"
                value={ORIGIN_LABELS[lead.origem]}
              />
              <Field
                label="Data de criação"
                value={new Date(lead.created_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
              <Field label="Orçamento" value={lead.orcamento} />
              <Field label="Necessidade" value={lead.necessidade} />
              <Field label="Prazo / início" value={lead.prazo} />
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Qualificação
            </h2>
            <LeadFlags lead={lead} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Anotações
            </h2>
            <NotesEditor leadId={lead.id} initial={lead.anotacoes} />
          </section>
        </aside>

        {/* Coluna da conversa + follow-ups */}
        <div className="space-y-4">
          <Conversation
            leadId={lead.id}
            messages={messages}
            hasWhatsapp={hasWhatsapp}
          />
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <FollowUpPanel
              leadId={lead.id}
              followUps={followUps}
              botPausado={lead.bot_pausado}
              hasWhatsapp={hasWhatsapp}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
