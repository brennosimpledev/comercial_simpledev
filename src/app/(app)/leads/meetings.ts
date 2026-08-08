"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/tokens";
import { createMeetEvent, deleteEvent } from "@/lib/google/calendar";
import { sendWhatsAppText } from "@/lib/evolution/client";

function firstName(nome: string) {
  return (nome ?? "").trim().split(/\s+/)[0] || "";
}

function fmtBR(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// Agenda uma reuniao: cria o evento no Google com link do Meet, convida o
// lead por e-mail e (opcional) manda o link no WhatsApp.
export async function scheduleMeeting(
  leadId: string,
  opts: {
    startLocal: string; // "YYYY-MM-DDTHH:mm" (horario de Brasilia)
    durationMin: number;
    titulo?: string;
    notifyWhatsapp?: boolean;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  if (!opts.startLocal) return { error: "Escolha data e horário." };

  const token = await getValidAccessToken(supabase, user.id);
  if (!token) return { error: "Conecte sua conta Google primeiro." };

  const { data: lead } = await supabase
    .from("leads")
    .select("nome, email, whatsapp")
    .eq("id", leadId)
    .single();
  if (!lead) return { error: "Lead não encontrado." };

  // "-03:00" = horario de Brasilia (sem horario de verao desde 2019).
  const start = new Date(`${opts.startLocal}:00-03:00`);
  if (isNaN(start.getTime())) return { error: "Data/horário inválido." };
  const end = new Date(start.getTime() + (opts.durationMin || 30) * 60_000);

  const result = await createMeetEvent(token, {
    summary: opts.titulo?.trim() || `Reunião — ${lead.nome}`,
    description: `Reunião comercial com ${lead.nome} (SimpleDEV).`,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    attendeeEmail: lead.email ?? undefined,
  });

  if (!result.ok) {
    console.error("[scheduleMeeting]", result.error);
    return { error: "Não foi possível criar o evento no Google." };
  }

  await supabase.from("meetings").insert({
    lead_id: leadId,
    created_by: user.id,
    titulo: opts.titulo?.trim() || `Reunião — ${lead.nome}`,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    google_event_id: result.eventId ?? null,
    meet_link: result.meetLink ?? null,
    html_link: result.htmlLink ?? null,
    status: "agendada",
  });

  await supabase
    .from("leads")
    .update({ estagio: "reuniao_marcada" })
    .eq("id", leadId);

  // Envia o link por WhatsApp, se pedido.
  if (opts.notifyWhatsapp && lead.whatsapp && result.meetLink) {
    const msg =
      `Olá ${firstName(lead.nome)}! Sua reunião com a SimpleDEV está agendada ` +
      `para ${fmtBR(start)}.\n\nLink do Google Meet: ${result.meetLink}`;
    const sent = await sendWhatsAppText(lead.whatsapp, msg);
    await supabase.from("lead_messages").insert({
      lead_id: leadId,
      direction: "outbound",
      body: msg,
      wa_message_id: sent.waMessageId ?? null,
      status: sent.ok ? "sent" : "failed",
      sent_by: user.id,
    });
  }

  revalidatePath(`/leads/${leadId}`);
  return { ok: true, meetLink: result.meetLink };
}

// Cancela a reuniao (remove do Google e marca como cancelada).
export async function cancelMeeting(meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: mtg } = await supabase
    .from("meetings")
    .select("lead_id, google_event_id")
    .eq("id", meetingId)
    .single();
  if (!mtg) return { error: "Reunião não encontrada." };

  const token = await getValidAccessToken(supabase, user.id);
  if (token && mtg.google_event_id) {
    await deleteEvent(token, mtg.google_event_id);
  }

  await supabase
    .from("meetings")
    .update({ status: "cancelada" })
    .eq("id", meetingId);

  revalidatePath(`/leads/${mtg.lead_id}`);
  return { ok: true };
}

// Desconecta a conta Google do usuario.
export async function disconnectGoogle() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };
  await supabase.from("google_accounts").delete().eq("user_id", user.id);
  revalidatePath("/leads");
  return { ok: true };
}
