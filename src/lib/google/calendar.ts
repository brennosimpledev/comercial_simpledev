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

// Atualiza horário de um evento existente no Google Calendar.
export async function patchEvent(
  accessToken: string,
  eventId: string,
  opts: { startISO: string; endISO: string }
): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: { dateTime: opts.startISO, timeZone: "America/Sao_Paulo" },
        end: { dateTime: opts.endISO, timeZone: "America/Sao_Paulo" },
      }),
    }
  );
  return res.ok;
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

export interface PeriodoOcupado {
  inicio: string; // ISO
  fim: string;
}

// Periodos ocupados na agenda principal, a partir dos eventos. O escopo da
// conta (calendar.events) nao cobre a consulta freeBusy, mas permite listar
// eventos. Evento marcado como "disponivel" (transparent) nao ocupa; evento
// de dia inteiro ocupa o dia todo, por seguranca. Devolve null se a leitura
// falhar, para quem chama nao confundir erro com agenda vazia.
export async function listarOcupados(
  accessToken: string,
  minISO: string,
  maxISO: string
): Promise<PeriodoOcupado[] | null> {
  const params = new URLSearchParams({
    timeMin: minISO,
    timeMax: maxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      console.error("[calendar] listarOcupados HTTP", res.status);
      return null;
    }
    const data = (await res.json()) as {
      items?: {
        status?: string;
        transparency?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }[];
    };
    const ocupados: PeriodoOcupado[] = [];
    for (const ev of data.items ?? []) {
      if (ev.status === "cancelled" || ev.transparency === "transparent") continue;
      const inicio = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00-03:00` : null);
      const fim = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00-03:00` : null);
      if (inicio && fim) ocupados.push({ inicio, fim });
    }
    return ocupados;
  } catch (e) {
    console.error("[calendar] listarOcupados:", e);
    return null;
  }
}
