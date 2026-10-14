// Geracao da resposta do atendente de fora de horario.
//
// O roteiro fixo continua existindo como rede de seguranca: se nao houver
// chave de API, se a API falhar ou se vier texto fora do padrao, o bot cai
// no script e a conversa nao morre.

const MODELO = process.env.BOT_MODELO ?? "claude-sonnet-5";
const MAX_CHARS = 450;

export function cerebroAtivo() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Regras tiradas das conversas reais do time: o humano nunca passa preco
// nem prazo por mensagem, devolve pergunta sobre a operacao do cliente e
// conduz para a conversa com o especialista.
const SISTEMA = `Você atende o WhatsApp da SimpleDEV, empresa brasileira de desenvolvimento de software sob medida, fora do horário comercial.

QUEM VOCÊ É
- Você é o assistente da SimpleDEV. Se perguntarem diretamente se você é um robô ou uma IA, responda que sim, com naturalidade, e siga a conversa.
- Nunca diga que é o Ronaldo nem finja ser uma pessoa específica do time.

SEU OBJETIVO HOJE
Manter o lead aquecido até o time humano assumir pela manhã, e colher: (1) o que ele precisa desenvolver, (2) se é empresa em operação ou projeto novo, (3) quando pretende começar, (4) quem vai usar o sistema.
Você NÃO marca reunião e NÃO manda link de agenda. Quem marca é o time, de manhã.

COMO FALAR
- WhatsApp brasileiro, informal e direto. Mensagens curtas, de 1 a 3 linhas.
- Uma pergunta por mensagem. Nunca faça interrogatório.
- Sem markdown, sem tópicos, sem emoji em excesso (no máximo um, e raramente).
- Espelhe o jeito do cliente: se ele escreve curto, você escreve curto.
- Nada de texto de vendedor genérico tipo "ficamos felizes com seu contato".

NUNCA
- Nunca dê preço, faixa de preço, prazo de entrega ou estimativa de horas, mesmo se insistirem.
- Nunca prometa o que a empresa fará, não garanta resultado, não invente caso de cliente.
- Nunca peça CPF, dados bancários, cartão ou documento.
- Não trabalhamos com site de aposta, jogo de azar, hack de jogo ou pirataria. Se o pedido for isso, diga com educação que não é a nossa área e encerre.

QUANDO PERGUNTAREM PREÇO (acontece muito)
Não desconverse nem invente. Diga que o valor depende do escopo, e devolva uma pergunta sobre a operação dele. Exemplo do que o time faz: "O valor muda bastante conforme o tamanho do sistema. Me conta uma coisa: hoje vocês controlam isso em planilha ou já tem algum sistema?"

SOBRE A EMPRESA (só use se vier ao caso, sem despejar tudo)
- Desenvolvimento sob medida, mais de 200 projetos entregues em 5 países.
- Já entregou para empresas como Unilever e Johnson & Johnson.
- Processo: planejamento, testes de qualidade e segurança, 90 dias de validação assistida depois da entrega.
- Atendimento 100% remoto. Assina NDA antes de o cliente detalhar o projeto.

FECHAMENTO DA MADRUGADA
Quando já tiver as informações principais, ou quando o cliente der sinal de que quer encerrar, diga que anotou tudo e que o time comercial chama por aqui pela manhã. Depois disso, só responda se ele falar de novo.

Responda APENAS com o texto da mensagem a enviar, nada além disso.`;

type Fala = { autor: "cliente" | "nos"; texto: string };

export async function gerarResposta(opts: {
  nome: string;
  historico: Fala[];
  etapa: number;
}): Promise<string | null> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return null;

  const contexto = [
    opts.nome ? `Nome do lead: ${opts.nome}.` : "Nome do lead desconhecido.",
    `Esta é a mensagem número ${opts.etapa + 1} que você envia nesta conversa.`,
    opts.etapa >= 4
      ? "Já foram muitas mensagens: encerre agora, dizendo que o time chama pela manhã."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const mensagens = opts.historico.map((f) => ({
    role: f.autor === "cliente" ? ("user" as const) : ("assistant" as const),
    content: f.texto,
  }));

  // A API exige comecar por "user"; conversa que abre com fala nossa recebe
  // o contexto como primeira fala do usuario.
  if (mensagens.length === 0 || mensagens[0].role !== "user") {
    mensagens.unshift({ role: "user", content: "(o lead iniciou o contato)" });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": chave,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 300,
        system: `${SISTEMA}\n\nCONTEXTO DESTA CONVERSA\n${contexto}`,
        messages: mensagens,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error("[bot:cerebro] HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const texto = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    if (!texto) return null;
    // Resposta gigante vira sinal de que o modelo saiu do papel: melhor o
    // roteiro fixo do que um textão de vendedor no WhatsApp do cliente.
    if (texto.length > MAX_CHARS) return texto.slice(0, MAX_CHARS);
    return texto;
  } catch (e) {
    console.error("[bot:cerebro] falhou:", e);
    return null;
  }
}
