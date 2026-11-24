// Etiqueta com a avaliacao que o bot deixou no lead. A mais importante e
// "SDR qualificar": o bot ficou em duvida e o lead precisa de gente.

const CONFIG: Record<string, { texto: string; titulo: string; cls: string }> = {
  agendado: {
    texto: "📅 Agendado pelo bot",
    titulo: "O bot marcou a reunião. Confira o resumo nas anotações e, se o lead for bom, clique em qualificar: só o clique de uma pessoa avisa a Meta.",
    cls: "bg-emerald-500/15 text-emerald-300",
  },
  qualificado: {
    texto: "✅ Bot: qualificado",
    titulo: "Passou na triagem automática (bot ou formulário), sem reunião marcada. Falta uma pessoa confirmar e clicar em qualificar: só esse clique avisa a Meta.",
    cls: "bg-brand/15 text-brand",
  },
  sdr: {
    texto: "🧑 SDR qualificar",
    titulo: "O bot ficou em dúvida e não agendou. Melhor o SDR qualificar pessoalmente.",
    cls: "bg-amber-500/15 text-amber-300",
  },
  sem_resposta: {
    texto: "💤 Não respondeu ao bot",
    titulo: "O bot mandou a primeira mensagem e o lead não respondeu a ele. O SDR segue normalmente.",
    cls: "bg-white/5 text-slate-400",
  },
  nao_qualificado: {
    texto: "Bot: não qualificado",
    titulo: "O bot encontrou um motivo para não qualificar. Veja o resumo nas anotações.",
    cls: "bg-white/5 text-slate-400",
  },
};

export function EtiquetaBot({ avaliacao }: { avaliacao: string | null | undefined }) {
  const c = avaliacao ? CONFIG[avaliacao] : undefined;
  if (!c) return null;
  return (
    <span
      title={c.titulo}
      className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${c.cls}`}
    >
      {c.texto}
    </span>
  );
}
