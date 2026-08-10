"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, getTeamAccessToken } from "@/lib/google/tokens";
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

export async function scheduleMeeting(
  leadId: string,
  opts: {
    startLocal: string;
    durationMin: number;
    attendeeEmail?: string;
    notifyWhatsapp?: boolean;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  if (!opts.startLocal) return { error: "Escolha data e horário." };

  const token =
    (await getValidAccessToken(supabase, user.id)) ??
    (await getTeamAccessToken(supabase));
  if (!token) return { error: "Nenhuma conta Google conectada na equipe." };

  const { data: lead } = await supabase
    .from("leads")
    .select("nome, email, whatsapp")
    .eq("id", leadId)
    .single();
  if (!lead) return { error: "Lead não encontrado." };

  const start = new Date(`${opts.startLocal}:00-03:00`);
  if (isNaN(start.getTime())) return { error: "Data/horário inválido." };

  const timePart = opts.startLocal.split("T")[1] ?? "";
  const [brH, brM] = timePart.split(":").map(Number);
  const totalMin = brH * 60 + brM;
  const inMorning = totalMin >= 540 && totalMin < 720;
  const inAfternoon = totalMin >= 840 && totalMin < 1080;
  if (!inMorning && !inAfternoon) {
    return { error: "Horário fora do comercial (9h–12h ou 14h–18h)." };
  }

  const datePart = opts.startLocal.split("T")[0];
  const [y, mo, da] = datePart.split("-").map(Number);
  const dow = new Date(y, mo - 1, da).getDay();
  if (dow === 0 || dow === 6) {
    return { error: "Reuniões apenas de segunda a sexta." };
  }

  const end = new Date(start.getTime() + (opts.durationMin || 30) * 60_000);

  const title = `${lead.nome} — SimpleDEV`;
  const emailForInvite = opts.attendeeEmail?.trim() || lead.email;

  if (opts.attendeeEmail?.trim() && !lead.email) {
    await supabase
      .from("leads")
      .update({ email: opts.attendeeEmail.trim() })
      .eq("id", leadId);
  }

  const result = await createMeetEvent(token, {
    summary: title,
    description: `Reunião comercial com ${lead.nome} (SimpleDEV).`,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    attendeeEmail: emailForInvite ?? undefined,
  });

  if (!result.ok) {
    console.error("[scheduleMeeting]", result.error);
    return { error: "Não foi possível criar o evento no Google." };
  }

  await supabase.from("meetings").insert({
    lead_id: leadId,
    created_by: user.id,
    titulo: title,
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

  if (opts.notifyWhatsapp && lead.whatsapp && result.meetLink) {
    const msg =
      `Olá ${firstName(lead.nome)}! Sua reunião com a SimpleDEV está agendada ` +
      `para ${fmtBR(start)}.\n\nLink do Google Meet: ${result.meetLink}\n\nTe esperamos lá!`;
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
  revalidatePath("/reunioes");
  return { ok: true, meetLink: result.meetLink };
}

export async function updateMeetingStatus(
  meetingId: string,
  status: "realizada" | "furada" | "cancelada"
) {
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

  if (status === "cancelada") {
    const token =
      (await getValidAccessToken(supabase, user.id)) ??
      (await getTeamAccessToken(supabase));
    if (token && mtg.google_event_id) {
      await deleteEvent(token, mtg.google_event_id);
    }
  }

  await supabase
    .from("meetings")
    .update({ status })
    .eq("id", meetingId);

  revalidatePath("/reunioes");
  revalidatePath(`/leads/${mtg.lead_id}`);
  return { ok: true };
}

export async function cancelMeeting(meetingId: string) {
  return updateMeetingStatus(meetingId, "cancelada");
}

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
