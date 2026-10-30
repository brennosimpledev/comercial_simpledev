// Confirmacao e lembretes de reuniao: quando sai cada mensagem e o texto.
//
//   vespera  dia util anterior, 10h: pede confirmacao
//   1h       uma hora antes: lembra com o link do Meet
//   furo     depois de marcada como furada: oferece horarios para remarcar
//
// As respostas do cliente vao para o bot de reuniao (lib/bot/reuniao.ts).

import type { Horario } from "@/lib/agenda";
import { ehFeriado } from "@/lib/feriados";

const BR_MS = 3 * 3600_000;
export const HORA_VESPERA = Number(process.env.LEMBRETE_HORA_VESPERA ?? 10);

export function lembretesLigados() {
  const v = (process.env.LEMBRETES_AUTO ?? "").toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

const partesBR = (d: Date) => {
  const b = new Date(d.getTime() - BR_MS);
  return { ano: b.getUTCFullYear(), mes: b.getUTCMonth(), dia: b.getUTCDate(), semana: b.getUTCDay(), hora: b.getUTCHours() };
};

/** Lembrete pode sair agora? 8h as 20h em Brasilia, qualquer dia. */
export function horaDeMandar(agora = new Date()) {
  const h = partesBR(agora).hora;
  return h >= 8 && h < 20;
}

/** Dia util anterior a reuniao, as 10h de Brasilia. */
export function vencimentoVespera(inicio: Date): Date {
  const p = partesBR(inicio);
  const d = new Date(Date.UTC(p.ano, p.mes, p.dia));
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || ehFeriado(d.toISOString().slice(0, 10)));
  return new Date(d.getTime() + HORA_VESPERA * 3600_000 + BR_MS);
}

const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "hoje às 14h", "amanhã, quinta-feira, às 14h", "segunda-feira, 03/11, às 9h". */
export function quandoE(inicio: Date, agora = new Date()) {
  const i = partesBR(inicio);
  const a = partesBR(agora);
  const dias = Math.round(
    (Date.UTC(i.ano, i.mes, i.dia) - Date.UTC(a.ano, a.mes, a.dia)) / 86_400_000
  );
  const b = new Date(inicio.getTime() - BR_MS);
  const min = b.getUTCMinutes();
  const hora = `${b.getUTCHours()}h${min ? String(min).padStart(2, "0") : ""}`;
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã, ${SEMANA[i.semana]}, às ${hora}`;
  return `${SEMANA[i.semana]}, ${String(i.dia).padStart(2, "0")}/${String(i.mes + 1).padStart(2, "0")}, às ${hora}`;
}

const oi = (nome: string) => (nome ? `Oi ${nome}!` : "Oi!");

export function textoVespera(nome: string, inicio: Date) {
  return `${oi(nome)} Passando para confirmar nossa conversa ${quandoE(inicio)}, com o especialista da SimpleDEV.\n\nFica confirmado? Se precisar mudar o horário, é só me avisar por aqui 🙂`;
}

export function texto1h(nome: string, inicio: Date, meetLink: string | null) {
  return (
    `${nome ? `${nome}, daqui` : "Daqui"} a pouco, ${quandoE(inicio)}, a gente se fala!` +
    (meetLink ? `\n\nLink do Google Meet: ${meetLink}` : "")
  );
}

/** "A", "A ou B", "A, B ou C". */
export function listaOu(itens: string[]) {
  return itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} ou ${itens[itens.length - 1]}`;
}

export function textoFuro(nome: string, inicio: Date, horarios: Horario[], agora = new Date()) {
  const dias = Math.round(
    (Date.UTC(partesBR(agora).ano, partesBR(agora).mes, partesBR(agora).dia) -
      Date.UTC(partesBR(inicio).ano, partesBR(inicio).mes, partesBR(inicio).dia)) /
      86_400_000
  );
  const qual = dias === 0 ? "de hoje" : dias === 1 ? "de ontem" : `de ${SEMANA[partesBR(inicio).semana]}`;
  const opcoes =
    horarios.length > 0
      ? `Tenho ${listaOu(horarios.map((h) => h.rotulo))}. Algum desses fica bom pra você?`
      : "Me fala um dia e horário que fica bom pra você?";
  return `${oi(nome)} Sentimos sua falta na nossa conversa ${qual}. Quer remarcar? ${opcoes}`;
}
