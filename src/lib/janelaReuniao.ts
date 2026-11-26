// Janela de horario em que uma reuniao pode comecar pela tela do CRM.
// Sem import de servidor: a tela usa para montar a lista de horarios e as
// actions (leads/meetings.ts) usam para validar. O bot nao passa por aqui:
// ele tem a janela propria em lib/agenda.ts (HORAS_INICIO).

// So estes logins marcam no almoco (12h e 13h) e as 18h (reuniao ate 19h).
// Todo o resto da equipe continua em 9h-12h e 14h-18h.
const JANELA_ESTENDIDA = ["brenno@simpledev.com.br"];

export function temJanelaEstendida(email?: string | null) {
  return JANELA_ESTENDIDA.includes((email ?? "").trim().toLowerCase());
}

// Em minutos do dia, horario de Brasilia. O inicio vale de deMin ate antes
// de ateMin.
type Grupo = { rotulo: string; deMin: number; ateMin: number };

function grupos(estendida: boolean): Grupo[] {
  return estendida
    ? [
        { rotulo: "Manhã (9h–12h)", deMin: 540, ateMin: 720 },
        { rotulo: "Almoço (12h–14h)", deMin: 720, ateMin: 840 },
        { rotulo: "Tarde (14h–19h)", deMin: 840, ateMin: 1140 },
      ]
    : [
        { rotulo: "Manhã (9h–12h)", deMin: 540, ateMin: 720 },
        { rotulo: "Tarde (14h–18h)", deMin: 840, ateMin: 1080 },
      ];
}

/**
 * Horas cheias em que a reuniao pode comecar, por periodo, de modo que ela
 * termine dentro do periodo. So hora cheia: reuniao as 9h30 ou 10h10
 * baguncava a agenda do time.
 */
export function horariosPorGrupo(estendida: boolean, durMin = 60) {
  return grupos(estendida)
    .map((g) => {
      const horas: string[] = [];
      for (let m = g.deMin; m <= g.ateMin - durMin; m += 60) {
        horas.push(`${String(m / 60).padStart(2, "0")}:00`);
      }
      return { rotulo: g.rotulo, horas };
    })
    .filter((g) => g.horas.length > 0);
}

/**
 * Mensagem de erro se o inicio (minutos do dia, Brasilia) cai fora da
 * janela de quem esta marcando; null se pode.
 */
export function foraDaJanela(totalMin: number, estendida: boolean): string | null {
  if (grupos(estendida).some((g) => totalMin >= g.deMin && totalMin < g.ateMin)) return null;
  return estendida
    ? "Horário fora da janela (9h–19h)."
    : "Horário fora do comercial (9h–12h ou 14h–18h).";
}
