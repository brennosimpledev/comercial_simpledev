// Regua de follow-up. Cada item vira um follow_up agendado quando o lead entra.
// offsetHours = horas apos a criacao do lead. Use [Nome] no texto.

export interface CadenceStep {
  key: string;
  titulo: string;
  offsetHours: number;
  body: string;
}

export const FOLLOWUP_CADENCE: CadenceStep[] = [
  {
    key: "abordagem_12h",
    titulo: "Abordagem",
    offsetHours: 12,
    body: "Oi [Nome], tudo bem? Vi que você entrou em contato com a gente sobre o desenvolvimento do seu sistema, mas acho que minha mensagem anterior pode ter passado batida.\n\nVamos retomar nossa conversa?",
  },
  {
    key: "abordagem_24h",
    titulo: "Abordagem",
    offsetHours: 24,
    body: "Oi [Nome], tudo bem? Vi que você demonstrou interesse em tirar seu projeto do papel e queria entender se ainda faz sentido avançarmos nessa conversa.",
  },
  {
    key: "reforco_48h",
    titulo: "Reforço",
    offsetHours: 48,
    body: "Olá [Nome]! Consigo te mostrar rapidamente como a gente estrutura um projeto como o seu. Prefere que eu te ligue ou seguimos por aqui mesmo?",
  },
  {
    key: "ultima_72h",
    titulo: "Última tentativa",
    offsetHours: 72,
    body: "[Nome], não quero ser insistente 🙂. Se agora não for o momento ideal, sem problema — me avisa que eu te procuro mais pra frente. Fico à disposição!",
  },
];

// Substitui [Nome] pelo primeiro nome do lead.
export function renderTemplate(body: string, nome: string): string {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] || "tudo bem";
  return body.replaceAll("[Nome]", primeiro);
}
