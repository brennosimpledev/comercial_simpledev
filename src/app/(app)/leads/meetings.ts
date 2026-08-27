"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, getTeamAccessToken } from "@/lib/google/tokens";
import { createMeetEvent, deleteEvent, patchEvent } from "@/lib/google/calendar";
import { sendWhatsAppText } from "@/lib/evolution/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMeetFiles, type DriveFile } from "@/lib/google/drive";

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
    (await getTeamAccessToken());
  if (!token) return { error: "Nenhuma conta Google conectada na equipe." };

  const { data: lead } = await supabase
    .from("leads")
    .select("nome, email, whatsapp, estagio")
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

  // So avanca o estagio; uma 2a/3a reuniao com lead em proposta ou fechado
  // nao pode puxa-lo de volta para reuniao_marcada.
  if (lead.estagio === "novo" || lead.estagio === "sdr") {
    await supabase
      .from("leads")
      .update({ estagio: "reuniao_marcada" })
      .eq("id", leadId);
  }

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
      (await getTeamAccessToken());
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

export async function updateMeetingNotes(
  meetingId: string,
  notes: { resumo?: string; transcricao?: string }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const update: Record<string, string | null> = {};
  if (notes.resumo !== undefined) update.resumo = notes.resumo;
  if (notes.transcricao !== undefined) update.transcricao = notes.transcricao;
  if (Object.keys(update).length === 0) return { ok: true };

  const { data: mtg } = await supabase
    .from("meetings")
    .select("lead_id")
    .eq("id", meetingId)
    .single();

  const { error: updateError } = await supabase
    .from("meetings")
    .update(update)
    .eq("id", meetingId);

  if (updateError) {
    console.error("[updateMeetingNotes]", updateError);
    return { error: `Erro ao salvar: ${updateError.message}` };
  }

  revalidatePath("/reunioes");
  if (mtg) revalidatePath(`/leads/${mtg.lead_id}`);
  return { ok: true };
}

export async function uploadTranscricao(meetingId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const file = formData.get("file") as File;
  if (!file || typeof file === "string")
    return { error: "Nenhum arquivo selecionado." };

  const admin = createAdminClient();
  await admin.storage.createBucket("meetings", { public: true });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${meetingId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from("meetings")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (upErr) {
    console.error("[uploadTranscricao]", upErr);
    return { error: "Falha ao enviar arquivo." };
  }

  const { data: urlData } = admin.storage
    .from("meetings")
    .getPublicUrl(path);

  const { error: dbErr } = await supabase
    .from("meetings")
    .update({ transcricao: urlData.publicUrl })
    .eq("id", meetingId);

  if (dbErr) {
    console.error("[uploadTranscricao db]", dbErr);
    return { error: "Arquivo enviado mas falha ao salvar link." };
  }

  const { data: mtg } = await supabase
    .from("meetings")
    .select("lead_id")
    .eq("id", meetingId)
    .single();

  revalidatePath("/reunioes");
  if (mtg) revalidatePath(`/leads/${mtg.lead_id}`);
  return { ok: true, url: urlData.publicUrl };
}

export async function deleteTranscricao(meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: mtg } = await supabase
    .from("meetings")
    .select("lead_id, transcricao")
    .eq("id", meetingId)
    .single();
  if (!mtg) return { error: "Reunião não encontrada." };

  if (mtg.transcricao) {
    try {
      const url = new URL(mtg.transcricao);
      const parts = url.pathname.split("/meetings/");
      if (parts[1]) {
        const admin = createAdminClient();
        await admin.storage.from("meetings").remove([decodeURIComponent(parts[1])]);
      }
    } catch {}
  }

  await supabase
    .from("meetings")
    .update({ transcricao: null })
    .eq("id", meetingId);

  revalidatePath("/reunioes");
  if (mtg) revalidatePath(`/leads/${mtg.lead_id}`);
  return { ok: true };
}

export async function rescheduleMeeting(
  meetingId: string,
  startLocal: string,
  durationMin: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  if (!startLocal) return { error: "Escolha data e horário." };

  const start = new Date(`${startLocal}:00-03:00`);
  if (isNaN(start.getTime())) return { error: "Data/horário inválido." };

  const timePart = startLocal.split("T")[1] ?? "";
  const [brH, brM] = timePart.split(":").map(Number);
  const totalMin = brH * 60 + brM;
  const inMorning = totalMin >= 540 && totalMin < 720;
  const inAfternoon = totalMin >= 840 && totalMin < 1080;
  if (!inMorning && !inAfternoon) {
    return { error: "Horário fora do comercial (9h–12h ou 14h–18h)." };
  }

  const datePart = startLocal.split("T")[0];
  const [y, mo, da] = datePart.split("-").map(Number);
  const dow = new Date(y, mo - 1, da).getDay();
  if (dow === 0 || dow === 6) {
    return { error: "Reuniões apenas de segunda a sexta." };
  }

  const end = new Date(start.getTime() + (durationMin || 30) * 60_000);

  const { data: mtg } = await supabase
    .from("meetings")
    .select("lead_id, google_event_id")
    .eq("id", meetingId)
    .single();
  if (!mtg) return { error: "Reunião não encontrada." };

  if (mtg.google_event_id) {
    const token =
      (await getValidAccessToken(supabase, user.id)) ??
      (await getTeamAccessToken());
    if (token) {
      await patchEvent(token, mtg.google_event_id, {
        startISO: start.toISOString(),
        endISO: end.toISOString(),
      });
    }
  }

  await supabase
    .from("meetings")
    .update({
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: "agendada",
    })
    .eq("id", meetingId);

  revalidatePath("/reunioes");
  revalidatePath(`/leads/${mtg.lead_id}`);
  return { ok: true };
}

// Procura no Drive a transcricao/gravacao que o Meet gerou para esta reuniao.
export async function buscarArquivosDoMeet(
  meetingId: string
): Promise<{ files?: DriveFile[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: mtg } = await supabase
    .from("meetings")
    .select("starts_at, leads(nome)")
    .eq("id", meetingId)
    .single();
  if (!mtg) return { error: "Reunião não encontrada." };

  const nome = (mtg.leads as unknown as { nome: string } | null)?.nome ?? "";

  const token =
    (await getValidAccessToken(supabase, user.id)) ??
    (await getTeamAccessToken());
  if (!token) return { error: "Nenhuma conta Google conectada." };

  const r = await findMeetFiles(token, {
    leadNome: nome,
    startsAt: mtg.starts_at as string,
  });

  if (!r.ok) {
    // Escopo novo: quem conectou antes do drive.readonly recebe 403 aqui.
    if ((r.error ?? "").toLowerCase().includes("insufficient")) {
      return {
        error:
          "Permissão do Drive ausente. Reconecte o Google em /api/google/connect.",
      };
    }
    return { error: r.error ?? "Falha ao consultar o Drive." };
  }
  return { files: r.files ?? [] };
}

// Salva o link de um arquivo do Drive como transcricao da reuniao.
export async function vincularTranscricao(meetingId: string, url: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase
    .from("meetings")
    .update({ transcricao: url })
    .eq("id", meetingId);
  if (error) return { error: `Erro ao salvar: ${error.message}` };

  revalidatePath("/reunioes");
  return { ok: true };
}

// Salva o link da gravacao do Meet (video no Drive).
export async function vincularGravacao(meetingId: string, url: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase
    .from("meetings")
    .update({ gravacao: url })
    .eq("id", meetingId);
  if (error) return { error: `Erro ao salvar: ${error.message}` };

  revalidatePath("/reunioes");
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
