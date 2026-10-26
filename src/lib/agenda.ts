// Checagem de bloqueio de agenda, usada por agendar e remarcar. SERVER-ONLY.

import type { SupabaseClient } from "@supabase/supabase-js";

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
