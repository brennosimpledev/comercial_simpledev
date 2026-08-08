import crypto from "crypto";

export interface CreateEventResult {
  ok: boolean;
  eventId?: string;
  meetLink?: string;
  htmlLink?: string;
  error?: unknown;
}

// Cria um evento no Google Calendar (primary) com link do Google Meet.
export async function createMeetEvent(
  accessToken: string,
  opts: {
    summary: string;
    description?: string;
    startISO: string; // instante (UTC)
    endISO: string;
    attendeeEmail?: string;
  }
): Promise<CreateEventResult> {
  const body = {
    summary: opts.summary,
    description: opts.description ?? "",
    start: { dateTime: opts.startISO, timeZone: "America/Sao_Paulo" },
    end: { dateTime: opts.endISO, timeZone: "America/Sao_Paulo" },
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 60 },
        { method: "popup", minutes: 30 },
      ],
    },
    ...(opts.attendeeEmail
      ? { attendees: [{ email: opts.attendeeEmail }] }
      : {}),
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();
  if (!res.ok) return { ok: false, error: data };

  return {
    ok: true,
    eventId: data.id,
    meetLink: data.hangoutLink,
    htmlLink: data.htmlLink,
  };
}

// Cancela (deleta) um evento no Google Calendar.
export async function deleteEvent(
  accessToken: string,
  eventId: string
): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
      eventId
    )}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return res.ok || res.status === 410; // 410 = ja removido
}
