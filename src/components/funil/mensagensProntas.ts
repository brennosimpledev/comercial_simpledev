// Mensagens prontas do closer. Entram no campo de texto para o Brenno
// revisar antes de enviar; nada sai sozinho.

export function primeiroNome(nome: string | null | undefined) {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!p) return "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function saudacaoDoHorario() {
  const h = Number(
    new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" })
  );
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export function mensagensProntas(nome: string | null | undefined) {
  const n = primeiroNome(nome);
  const ola = n ? `Olá, ${n}!` : "Olá!";
  return [
    {
      rotulo: "Saudação",
      texto: `${ola} Aqui é o Brenno, da SimpleDev. Tudo bem?`,
    },
    {
      rotulo: "Pós-reunião",
      texto: `${saudacaoDoHorario()}${n ? `, ${n}` : ""}! Obrigado pela reunião de hoje. Vou montar o escopo do seu projeto com o que conversamos e te mando por aqui.`,
    },
    {
      rotulo: "Cobrar retorno",
      texto: `${ola} Conseguiu dar uma olhada no material que te mandei? Me fala o que achou pra gente seguir.`,
    },
    {
      rotulo: "Marcar conversa",
      texto: `${ola} Quero alinhar os próximos passos do seu projeto com você. Qual o melhor horário pra gente conversar rapidinho?`,
    },
  ];
}

// Texto que acompanha o documento quando ele sai pelo WhatsApp.
export function textoDoDocumento(tipo: "escopo" | "proposta", nome: string | null | undefined) {
  const n = primeiroNome(nome);
  const abre = `${saudacaoDoHorario()}${n ? `, ${n}` : ""}, tudo bem? Aqui é o Brenno, da SimpleDev.`;
  return tipo === "escopo"
    ? `${abre} Segue o escopo do seu projeto, como combinamos. Dá uma olhada com calma e me fala o que achou.`
    : `${abre} Segue a proposta do seu projeto. Qualquer dúvida, me chama aqui que a gente conversa.`;
}
