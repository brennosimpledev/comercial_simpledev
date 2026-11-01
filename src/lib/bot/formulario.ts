// Respostas do formulario da Meta, guardadas em leads.necessidade como
// "chave: valor | chave: valor".

// "chave: valor | chave: valor" do formulario -> mapa.
export function respostasDoFormulario(necessidade: string | null | undefined) {
  const mapa: Record<string, string> = {};
  for (const parte of (necessidade ?? "").split("|")) {
    const i = parte.indexOf(":");
    if (i > 0) mapa[parte.slice(0, i).trim().toLowerCase()] = parte.slice(i + 1).trim();
  }
  return mapa;
}

export const resposta = (mapa: Record<string, string>, comeco: string) =>
  Object.entries(mapa).find(([k]) => k.startsWith(comeco))?.[1] ?? "";

export function emailDoFormulario(necessidade: string | null | undefined, email?: string | null) {
  const e = (email || resposta(respostasDoFormulario(necessidade), "work_email") || resposta(respostasDoFormulario(necessidade), "email"))
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

// Respostas do formulario em texto corrido, para o bot ter o contexto quando
// a pessoa responder (quem escreve sozinho manda isso na mensagem pronta).
export function formularioParaOBot(necessidade: string | null | undefined) {
  return Object.entries(respostasDoFormulario(necessidade))
    .filter(([k]) => !k.includes("email"))
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v.replace(/_/g, " ")}`)
    .join("; ");
}

