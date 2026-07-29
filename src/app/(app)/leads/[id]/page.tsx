import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Conversation } from "@/components/leads/Conversation";
import { LeadFlags } from "@/components/leads/LeadFlags";
import { FollowUpPanel } from "@/components/leads/FollowUpPanel";
import { NotesEditor } from "@/components/leads/NotesEditor";
import { LeadInfoEditor } from "@/components/leads/LeadInfoEditor";
import {
  STAGE_LABELS,
  type FollowUp,
  type Lead,
  type LeadMessage,
} from "@/types/database";

export const dynamic = "force-dynamic";

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
        <Link href="/leads" className="text-sm text-slate-400 hover:text-brand">
          ← Voltar
        </Link>
        <span className="rounded-full bg-brand/15 px-3 py-1 text-sm font-medium text-brand">
          {STAGE_LABELS[lead.estagio]}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Coluna de infos */}
        <aside className="space-y-4">
          <section className="sd-card p-5">
            <LeadInfoEditor lead={lead} />
          </section>

          <section className="sd-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">
              Qualificação
            </h2>
            <LeadFlags lead={lead} />
          </section>

          <section className="sd-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">
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
          <section className="sd-card p-5">
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
