// Agenda: bloqueios, horarios livres e agendamento pelo bot. SERVER-ONLY.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createMeetEvent, listarOcupados, patchEvent, type PeriodoOcupado } from "@/lib/google/calendar";
import { getTeamAccessToken } from "@/lib/google/tokens";

export function horaBR(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Devolve a mensagem de erro se o periodo cair num bloqueio, ou null se
 * estiver livre. Usado por agendar e remarcar, do lado do servidor, para
 * que nenhum caminho de agendamento passe por cima de um bloqueio.
 */
export async function conflitoComBloqueio(
  supabase: SupabaseClient,
  inicio: Date,
  fim: Date
): Promise<string | null> {
  const { data, error } = await supabase
    .from("agenda_bloqueios")
    .select("inicio, fim, motivo")
    .lt("inicio", fim.toISOString())
    .gt("fim", inicio.toISOString())
    .limit(1);
  // Tabela ainda nao criada: nao trava o agendamento.
  if (error || !data || data.length === 0) return null;
  const b = data[0];
  return `Horário bloqueado na agenda das ${horaBR(b.inicio as string)} às ${horaBR(
    b.fim as string
  )}${b.motivo ? ` (${b.motivo})` : ""}. Escolha outro horário.`;
}

// ---------------------------------------------------------------------
// Horarios livres e agendamento pelo bot.
// ---------------------------------------------------------------------

// Mesma janela que o CRM aceita para reuniao: 9h-12h e 14h-18h, dias uteis.
const HORAS_INICIO = [9, 10, 11, 14, 15, 16, 17];
export const DURACAO_BOT_MIN = Number(process.env.BOT_DURACAO_MIN ?? 30);
// Antecedencia minima: da tempo de o time ver o lead antes da reuniao.
const ANTECEDENCIA_H = Number(process.env.BOT_ANTECEDENCIA_H ?? 10);
const DIAS_UTEIS_A_FRENTE = 3;

export type Horario = { iso: string; rotulo: string };

export function rotuloHorario(d: Date) {
  const dia = d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${dia} às ${horaBR(d.toISOString()).replace(":00", "h")}`;
}

const sobrepoe = (ini: number, fim: number, p: PeriodoOcupado) =>
  ini < new Date(p.fim).getTime() && fim > new Date(p.inicio).getTime();

async function ocupadosNoPeriodo(
  supabase: SupabaseClient,
  token: string | null,
  min: Date,
  max: Date
): Promise<PeriodoOcupado[] | null> {
  // Sem ler a agenda do Google, o bot nao oferece horario: poderia marcar
  // em cima de um compromisso que so existe la.
  if (!token) return null;

  const [{ data: reunioes }, { data: bloqueios }, google] = await Promise.all([
    supabase
      .from("meetings")
      .select("starts_at, ends_at")
      .eq("status", "agendada")
      .lt("starts_at", max.toISOString())
      .gt("ends_at", min.toISOString()),
    supabase
      .from("agenda_bloqueios")
      .select("inicio, fim")
      .lt("inicio", max.toISOString())
      .gt("fim", min.toISOString()),
    listarOcupados(token, min.toISOString(), max.toISOString()),
  ]);
  if (google === null) return null;

  return [
    ...(reunioes ?? []).map((r) => ({ inicio: r.starts_at as string, fim: r.ends_at as string })),
    ...(bloqueios ?? []).map((b) => ({ inicio: b.inicio as string, fim: b.fim as string })),
    ...google,
  ];
}

/**
 * Ate 3 horarios livres para o bot oferecer, espalhados: o primeiro livre,
 * um no outro periodo do mesmo dia e um em outro dia. Lista vazia quando a
 * agenda nao pode ser lida - o bot entao nao oferece horario nenhum.
 */
export async function horariosLivres(
  supabase: SupabaseClient,
  agora = new Date()
): Promise<Horario[]> {
  const token = await getTeamAccessToken();
  const minimo = agora.getTime() + ANTECEDENCIA_H * 3600_000;

  // Candidatos nos proximos dias uteis, em horario de Brasilia (UTC-3).
  const candidatos: Date[] = [];
  const hojeBR = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  let uteis = 0;
  for (let d = 0; d < 10 && uteis < DIAS_UTEIS_A_FRENTE; d++) {
    const dia = new Date(hojeBR.getFullYear(), hojeBR.getMonth(), hojeBR.getDate() + d);
    const semana = dia.getDay();
    if (semana === 0 || semana === 6) continue;
    const ymd = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(
      dia.getDate()
    ).padStart(2, "0")}`;
    let temAlgum = false;
    for (const h of HORAS_INICIO) {
      const ini = new Date(`${ymd}T${String(h).padStart(2, "0")}:00:00-03:00`);
      if (ini.getTime() >= minimo) {
        candidatos.push(ini);
        temAlgum = true;
      }
    }
    if (temAlgum) uteis++;
  }
  if (candidatos.length === 0) return [];

  const ultimo = candidatos[candidatos.length - 1];
  const ocupados = await ocupadosNoPeriodo(
    supabase,
    token,
    candidatos[0],
    new Date(ultimo.getTime() + DURACAO_BOT_MIN * 60_000)
  );
  if (ocupados === null) return [];

  const livres = candidatos.filter((c) => {
    const ini = c.getTime();
    const fim = ini + DURACAO_BOT_MIN * 60_000;
    return !ocupados.some((p) => sobrepoe(ini, fim, p));
  });
  if (livres.length === 0) return [];

  const diaDe = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const manha = (d: Date) => Number(horaBR(d.toISOString()).slice(0, 2)) < 12;

  const escolhidos: Date[] = [livres[0]];
  const outroPeriodo = livres.find(
    (d) => diaDe(d) === diaDe(livres[0]) && manha(d) !== manha(livres[0])
  );
  if (outroPeriodo) escolhidos.push(outroPeriodo);
  const outroDia = livres.find((d) => diaDe(d) !== diaDe(livres[0]));
  if (outroDia) escolhidos.push(outroDia);
  for (const d of livres) {
    if (escolhidos.length >= 3) break;
    if (!escolhidos.includes(d)) escolhidos.push(d);
  }

  return escolhidos
    .slice(0, 3)
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d) => ({ iso: d.toISOString(), rotulo: rotuloHorario(d) }));
}

/**
 * Marca a reuniao escolhida pelo cliente. Confere de novo se o horario
 * continua livre (pode ter sido ocupado desde que foi oferecido), cria o
 * evento com Meet no Google, registra no CRM e avanca o estagio do lead.
 * Nao envia mensagem: quem chama manda a confirmacao.
 */
export async function agendarPeloBot(
  supabase: SupabaseClient,
  leadId: string,
  inicioISO: string
): Promise<{ ok: true; meetLink: string | null; inicio: Date } | { ok: false; motivo: string }> {
  const inicio = new Date(inicioISO);
  if (isNaN(inicio.getTime())) return { ok: false, motivo: "horario_invalido" };
  const fim = new Date(inicio.getTime() + DURACAO_BOT_MIN * 60_000);

  const token = await getTeamAccessToken();
  if (!token) return { ok: false, motivo: "sem_conta_google" };

  const ocupados = await ocupadosNoPeriodo(supabase, token, inicio, fim);
  if (ocupados === null) return { ok: false, motivo: "agenda_ilegivel" };
  if (ocupados.some((p) => sobrepoe(inicio.getTime(), fim.getTime(), p))) {
    return { ok: false, motivo: "horario_ocupado" };
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("nome, email, estagio")
    .eq("id", leadId)
    .single();
  if (!lead) return { ok: false, motivo: "lead_nao_encontrado" };

  const titulo = `${lead.nome} — SimpleDEV`;
  const evento = await createMeetEvent(token, {
    summary: titulo,
    description: `Reunião comercial com ${lead.nome} (SimpleDEV). Agendada pelo assistente automático; o resumo do atendimento está nas anotações do lead no CRM.`,
    startISO: inicio.toISOString(),
    endISO: fim.toISOString(),
    attendeeEmail: (lead.email as string | null) ?? undefined,
  });
  if (!evento.ok) {
    console.error("[agendarPeloBot] Google:", evento.error);
    return { ok: false, motivo: "falha_google" };
  }

  await supabase.from("meetings").insert({
    lead_id: leadId,
    created_by: null,
    titulo,
    starts_at: inicio.toISOString(),
    ends_at: fim.toISOString(),
    google_event_id: evento.eventId ?? null,
    meet_link: evento.meetLink ?? null,
    html_link: evento.htmlLink ?? null,
    status: "agendada",
  });

  if (lead.estagio === "novo" || lead.estagio === "sdr") {
    await supabase
      .from("leads")
      .update({ estagio: "reuniao_marcada", estagio_em: new Date().toISOString() })
      .eq("id", leadId);
  }

  return { ok: true, meetLink: evento.meetLink ?? null, inicio };
}

// Campos de lembrete zerados a cada novo horario: a confirmacao vale para
// o horario em que foi dada. Update separado para nao falhar sem a 0021.
export async function zerarConfirmacao(supabase: SupabaseClient, meetingId: string) {
  await supabase
    .from("meetings")
    .update({
      marcada_em: new Date().toISOString(),
      confirmacao: null,
      confirmacao_em: null,
      lembrete_vespera_em: null,
      lembrete_1h_em: null,
    })
    .eq("id", meetingId);
}

/**
 * Remarca uma reuniao existente para o horario que o cliente escolheu.
 * Confere de novo se o horario continua livre, move o evento no Google
 * (o link do Meet continua o mesmo) e zera a confirmacao. Nao envia
 * mensagem: quem chama manda a confirmacao.
 */
export async function remarcarPeloBot(
  supabase: SupabaseClient,
  meetingId: string,
  inicioISO: string
): Promise<{ ok: true; meetLink: string | null; inicio: Date } | { ok: false; motivo: string }> {
  const inicio = new Date(inicioISO);
  if (isNaN(inicio.getTime())) return { ok: false, motivo: "horario_invalido" };

  const { data: mtg } = await supabase
    .from("meetings")
    .select("id, lead_id, starts_at, ends_at, google_event_id, meet_link, remarcacoes")
    .eq("id", meetingId)
    .single();
  if (!mtg) return { ok: false, motivo: "reuniao_nao_encontrada" };

  const duracao =
    new Date(mtg.ends_at as string).getTime() - new Date(mtg.starts_at as string).getTime() ||
    DURACAO_BOT_MIN * 60_000;
  const fim = new Date(inicio.getTime() + duracao);

  const token = await getTeamAccessToken();
  if (!token) return { ok: false, motivo: "sem_conta_google" };

  const ocupados = await ocupadosNoPeriodo(supabase, token, inicio, fim);
  if (ocupados === null) return { ok: false, motivo: "agenda_ilegivel" };
  // A propria reuniao (no horario antigo) nao conta como ocupado.
  const antigo = { inicio: mtg.starts_at as string, fim: mtg.ends_at as string };
  const outros = ocupados.filter((p) => !(p.inicio === antigo.inicio && p.fim === antigo.fim));
  if (outros.some((p) => sobrepoe(inicio.getTime(), fim.getTime(), p))) {
    return { ok: false, motivo: "horario_ocupado" };
  }

  if (mtg.google_event_id) {
    const movido = await patchEvent(token, mtg.google_event_id as string, {
      startISO: inicio.toISOString(),
      endISO: fim.toISOString(),
    });
    if (!movido) return { ok: false, motivo: "falha_google" };
  }

  await supabase
    .from("meetings")
    .update({ starts_at: inicio.toISOString(), ends_at: fim.toISOString(), status: "agendada" })
    .eq("id", meetingId);
  await supabase
    .from("meetings")
    .update({ remarcacoes: (Number(mtg.remarcacoes) || 0) + 1 })
    .eq("id", meetingId);
  await zerarConfirmacao(supabase, meetingId);

  return { ok: true, meetLink: (mtg.meet_link as string | null) ?? null, inicio };
}
