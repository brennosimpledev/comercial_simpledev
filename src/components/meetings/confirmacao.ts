// Etiqueta de confirmacao de uma reuniao futura: diz se da para contar
// com o horario ou se ele pode ser usado por outro cliente.

type ComConfirmacao = {
  status: string;
  starts_at: string;
  confirmacao?: string | null;
  lembrete_vespera_em?: string | null;
};

export type Etiqueta = { icone: string; texto: string; titulo: string; cls: string };

export function etiquetaConfirmacao(m: ComConfirmacao): Etiqueta | null {
  if (m.status !== "agendada" || new Date(m.starts_at).getTime() < Date.now() - 3600_000) return null;
  switch (m.confirmacao) {
    case "confirmada":
      return {
        icone: "✅",
        texto: "Confirmada",
        titulo: "O cliente confirmou presença.",
        cls: "bg-emerald-500/15 text-emerald-300",
      };
    case "remarcar":
      return {
        icone: "⚠️",
        texto: "Pediu remarcação",
        titulo: "O cliente pediu outro horário. O bot oferece horários se o time não responder em 20 min.",
        cls: "bg-amber-500/15 text-amber-300",
      };
    case "cancelar":
      return {
        icone: "⛔",
        texto: "Quer cancelar",
        titulo: "O cliente disse que quer cancelar. Fale com ele antes de liberar o horário.",
        cls: "bg-red-500/15 text-red-300",
      };
  }
  if (m.lembrete_vespera_em) {
    return {
      icone: "⏳",
      texto: "Não confirmou",
      titulo: "A confirmação foi enviada e o cliente ainda não respondeu. Vale ligar antes.",
      cls: "bg-orange-500/15 text-orange-300",
    };
  }
  return {
    icone: "🕒",
    texto: "Confirmação a enviar",
    titulo: "A confirmação sai no dia útil anterior, às 10h.",
    cls: "bg-white/5 text-slate-400",
  };
}
