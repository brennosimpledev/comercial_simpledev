import { ehFeriado } from "@/lib/feriados";

// Regua automatica de follow-up para quem nunca respondeu.
//
// Conta a partir do primeiro contato nosso (bot ou time), sempre em dia
// util e em horario comercial: nada de mensagem de madrugada nem no fim de
// semana. "dias" e quantos dias uteis depois do dia da primeira tentativa.
// Quem respondeu pelo menos uma vez sai da regua e, se parar no meio da
// conversa, vai para a fila do Ronaldo (/followups) com mensagem sugerida.

export interface PassoRegua {
  key: string;
  titulo: string;
  dias: number;
  hora: number;
  /** Trecho que reconhece o passo ja mandado, inclusive a mao pelo time. */
  marca: string;
  texto: (nome: string) => string;
}

const oi = (nome: string) => (nome ? `Oi ${nome}, tudo bem?` : "Oi, tudo bem?");

export const REGUA_AUTOMATICA: PassoRegua[] = [
  {
    key: "auto_1",
    marca: "passado batida",
    titulo: "Mesmo dia à tarde",
    dias: 0,
    hora: 14,
    texto: (n) =>
      `${oi(n)} Vi que você entrou em contato com a gente sobre o desenvolvimento do seu sistema, mas acho que minha mensagem anterior pode ter passado batida.\n\nVamos retomar nossa conversa?`,
  },
  {
    key: "auto_2",
    marca: "ainda faz sentido avançarmos",
    titulo: "Dia seguinte de manhã",
    dias: 1,
    hora: 9,
    texto: (n) =>
      `${oi(n)} Vi que você demonstrou interesse em tirar seu projeto do papel e queria entender se ainda faz sentido avançarmos nessa conversa.`,
  },
  {
    key: "auto_3",
    marca: "como a gente estrutura um projeto",
    titulo: "3 dias úteis depois",
    dias: 3,
    hora: 14,
    texto: (n) =>
      `Olá${n ? ` ${n}` : ""}! Consigo te mostrar rapidamente como a gente estrutura um projeto como o seu. Prefere que eu te ligue ou seguimos por aqui mesmo?`,
  },
  {
    key: "auto_4",
    marca: "não quero ser insistente",
    titulo: "Última tentativa",
    dias: 6,
    hora: 9,
    texto: (n) =>
      `${n ? `${n}, não` : "Não"} quero ser insistente 🙂. Se agora não for o momento ideal, sem problema, me avisa que eu te procuro mais pra frente. Fico à disposição!`,
  },
];

// Brasil sem horario de verao desde 2019: Brasilia e sempre UTC-3.
const BR_MS = 3 * 3600_000;

function ehDiaUtil(diaUtc: Date) {
  const d = diaUtc.getUTCDay();
  return d !== 0 && d !== 6 && !ehFeriado(diaUtc.toISOString().slice(0, 10));
}

// Meia-noite (como data UTC) do dia de Brasilia em que o instante cai.
function diaBR(instante: Date) {
  const b = new Date(instante.getTime() - BR_MS);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
}

function somarDiasUteis(dia: Date, n: number) {
  const d = new Date(dia);
  let falta = n;
  while (falta > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (ehDiaUtil(d)) falta--;
  }
  return d;
}

const naHora = (dia: Date, hora: number) => new Date(dia.getTime() + hora * 3600_000 + BR_MS);

// Primeira tentativa: a tarde do primeiro dia util que deixe pelo menos 2h
// depois do primeiro contato (lead da noite recebe na tarde seguinte).
function diaDaPrimeira(primeiroContato: Date) {
  let dia = diaBR(primeiroContato);
  while (!ehDiaUtil(dia) || naHora(dia, 14).getTime() < primeiroContato.getTime() + 2 * 3600_000) {
    dia = new Date(dia.getTime() + 86_400_000);
  }
  return dia;
}

/** Quando o passo `i` da regua vence, para um lead com este primeiro contato. */
export function vencimentoDoPasso(primeiroContato: Date, i: number): Date {
  const passo = REGUA_AUTOMATICA[i];
  return naHora(somarDiasUteis(diaDaPrimeira(primeiroContato), passo.dias), passo.hora);
}

/** Dia util e entre 8h e 18h em Brasilia. */
export function horarioComercial(agora = new Date()) {
  const b = new Date(agora.getTime() - BR_MS);
  const dia = b.getUTCDay();
  const hora = b.getUTCHours();
  return dia !== 0 && dia !== 6 && !ehFeriado(b.toISOString().slice(0, 10)) && hora >= 8 && hora < 18;
}

// O nome do cadastro costuma ser o do perfil do WhatsApp, que as vezes e
// o da empresa ("Rcj imóveis", "Site Arerê"). O do formulario e o da pessoa.
export function nomeDoFormulario(msgs: { direction: string; body: string | null }[]) {
  for (const m of msgs) {
    if (m.direction !== "inbound") continue;
    const achado = (m.body ?? "").match(/(?:full name|nome completo)\s*:\s*([^\n]+)/i);
    if (achado) return achado[1].trim();
  }
  return null;
}

/** Primeiro nome que serve para saudacao ("WhatsApp 1234" nao serve). */
export function primeiroNome(nome: string | null | undefined) {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (/whatsapp/i.test(p)) return "";
  // So letras: "dgn_.js" ou "@fulano" no campo nome nao viram saudacao.
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'-]+$/.test(p)) return "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}
