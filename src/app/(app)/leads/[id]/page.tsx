import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Conversation } from "@/components/leads/Conversation";
import { LeadFlags } from "@/components/leads/LeadFlags";
import { FollowUpPanel } from "@/components/leads/FollowUpPanel";
import { NotesEditor } from "@/components/leads/NotesEditor";
import { LeadInfoEditor } from "@/components/leads/LeadInfoEditor";
import { MeetingsPanel } from "@/components/leads/MeetingsPanel";
import { BackLink } from "@/components/leads/BackLink";
import {
  STAGE_LABELS,
  type FollowUp,
  type Lead,
  type LeadMessage,
  type Meeting,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: leadRow }, { data: msgs }, { data: fus }, { data: mtgs }, { data: gacc }] =
    await Promise.all([
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
      supabase
        .from("meetings")
        .select("*")
        .eq("lead_id", id)
        .order("starts_at", { ascending: true }),
      createAdminClient()
        .from("google_accounts")
        .select("user_id")
        .limit(1)
        .maybeSingle(),
    ]);

  if (!leadRow) notFound();
  const lead = leadRow as Lead;
  const messages = (msgs ?? []) as LeadMessage[];
  const followUps = (fus ?? []) as FollowUp[];
  const meetings = (mtgs ?? []) as Meeting[];
  const googleConnected = Boolean(gacc);
  const hasWhatsapp = Boolean(lead.whatsapp);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <BackLink href="/leads" className="text-sm text-slate-400 hover:text-brand">
          ← Voltar
        </BackLink>
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
            <MeetingsPanel
              leadId={lead.id}
              meetings={meetings}
              googleConnected={googleConnected}
              hasWhatsapp={hasWhatsapp}
              leadName={lead.nome}
              leadEmail={lead.email}
            />
          </section>

          <section className="sd-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">
              Anotações SDR
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
