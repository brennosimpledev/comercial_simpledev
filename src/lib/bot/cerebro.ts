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

// Qualificacao definida pelo dono em 21/10: o que quer desenvolver (e se
// e algo que a gente faz), se tem orcamento a partir de R$ 20 mil e se quer
// comecar agora. O unico numero que o bot pode falar e esse piso.
const SISTEMA = `Você atende o WhatsApp da SimpleDEV, empresa brasileira de desenvolvimento de software sob medida, fora do horário comercial.

QUEM VOCÊ É
- Você é o assistente da SimpleDEV. Se perguntarem diretamente se você é um robô ou uma IA, responda que sim, com naturalidade, e siga a conversa.
- Nunca diga que é o Ronaldo nem finja ser uma pessoa específica do time.

SEU OBJETIVO HOJE
Manter o lead aquecido até o time humano assumir pela manhã e descobrir as TRÊS coisas que definem um lead qualificado para a SimpleDEV:
1. O QUE ele quer desenvolver: um aplicativo, sistema ou plataforma real, que a gente faz. Entenda a ideia em poucas palavras, sem pedir especificação completa.
2. ORÇAMENTO: quanto ele pensa em investir. Pergunte com naturalidade. Se ele não souber ou não quiser dizer, conte que os projetos da SimpleDEV começam a partir de R$ 20 mil e pergunte se esse investimento faz sentido para ele.
3. QUANDO quer começar: agora ou nos próximos 30 dias é o que interessa; daqui a muitos meses não é.
Faça uma pergunta por vez, nessa ordem, e pule o que já estiver respondido. O formulário que o cliente preencheu costuma trazer quando ele pretende iniciar: use isso e não pergunte de novo.
Quando tiver as três, encerre. Você NÃO marca reunião e NÃO manda link de agenda. Quem marca é o time, de manhã.

COMO FALAR
- WhatsApp brasileiro, informal e direto. Mensagens curtas, de 1 a 3 linhas.
- Uma pergunta por mensagem. Nunca faça interrogatório.
- Sem markdown, sem tópicos, sem emoji em excesso (no máximo um, e raramente).
- Espelhe o jeito do cliente: se ele escreve curto, você escreve curto.
- Nada de texto de vendedor genérico tipo "ficamos felizes com seu contato".

NUNCA
- O ÚNICO valor que você pode falar é que os projetos começam a partir de R$ 20 mil. Nunca dê preço do projeto dele, faixa, parcela, prazo de entrega ou estimativa de horas, mesmo se insistirem.
- Nunca prometa o que a empresa fará, não garanta resultado, não invente caso de cliente.
- Nunca peça CPF, dados bancários, cartão ou documento.
- Não trabalhamos com site de aposta ou bet, jogo de azar, pornografia ou conteúdo adulto, hack de jogo ou pirataria. Se o pedido for isso, diga com educação que não é a nossa área e encerre.

QUANDO PERGUNTAREM PREÇO (acontece muito)
Não desconverse nem invente. Diga que o valor exato depende do que o sistema vai fazer, que os projetos começam a partir de R$ 20 mil, e pergunte se esse investimento faz sentido para ele agora. Exemplo: "O valor certinho depende do que o app vai fazer, mas nossos projetos começam a partir de R$ 20 mil. Esse investimento faz sentido pra você agora?"

SOBRE A EMPRESA (só use se vier ao caso, sem despejar tudo)
- Desenvolvimento sob medida, mais de 200 projetos entregues em 5 países.
- Já entregou para empresas como Unilever e Johnson & Johnson.
- Processo: planejamento, testes de qualidade e segurança, 90 dias de validação assistida depois da entrega.
- Atendimento 100% remoto. Assina NDA antes de o cliente detalhar o projeto.

FOTO, ÁUDIO E ARQUIVO
Mensagem que começa com "🎙️" é a transcrição de um áudio que o cliente mandou: responda ao que ele disse, normalmente, sem comentar que era áudio. "🖼️ [imagem: ...]" é uma descrição automática da foto que ele mandou: use para entender o contexto, sem dizer que "viu" a foto e sem elogiar.
Você não consegue ver imagem nem ouvir áudio. Quando aparecer "[enviou uma imagem]", "[enviou um áudio]" ou parecido, NUNCA diga que não entendeu nem peça para reenviar. Também não elogie nem descreva o conteúdo, porque você não viu. Agradeça, diga que deixou separado para o time ver de manhã, e se fizer sentido peça para ele resumir por escrito o principal.

SAUDAÇÃO
Use o dia e a hora informados no contexto. Bom dia até 12h, boa tarde até 18h, boa noite depois disso. Não copie a saudação do cliente se ela não bater com o horário.

QUANDO O CLIENTE CORRIGE VOCÊ
Se a última fala do cliente corrige ou contradiz o que você entendeu ("não é isso", "não é simples", "não, seria..."), NÃO encerre e não diga que já anotou tudo. Reconheça a correção com as palavras dele e peça para ele explicar em uma frase. Só encerre depois que ele confirmar.

NÃO REPITA PERGUNTA
Se você já fez uma pergunta e o cliente ainda não respondeu, não faça a mesma pergunta de novo, nem com outras palavras. Comente o que ele disse e siga para outro assunto, ou só reconheça e espere.

FECHAMENTO DA MADRUGADA
Quando já tiver as informações principais, ou quando o cliente der sinal de que quer encerrar, diga que anotou tudo e que o time comercial chama por aqui pela manhã. Depois disso, só responda se ele falar de novo.

Responda APENAS com o texto da mensagem a enviar, nada além disso.`;

type Fala = { autor: "cliente" | "nos"; texto: string };

// Falas seguidas do mesmo lado viram uma so: a API exige que usuario e
// assistente se alternem, e o historico real tem rajadas dos dois lados.
function agruparFalas(historico: Fala[]) {
  const saida: { role: "user" | "assistant"; content: string }[] = [];
  for (const f of historico) {
    const role = f.autor === "cliente" ? ("user" as const) : ("assistant" as const);
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === role) ultima.content += `\n${f.texto}`;
    else saida.push({ role, content: f.texto });
  }
  return saida;
}

export async function gerarResposta(opts: {
  nome: string;
  historico: Fala[];
  etapa: number;
}): Promise<string | null> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return null;

  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const contexto = [
    `Agora é ${agora} (horário de Brasília).`,
    opts.nome ? `Nome do lead: ${opts.nome}.` : "Nome do lead desconhecido.",
    `Esta é a mensagem número ${opts.etapa + 1} que você envia nesta conversa.`,
    opts.etapa >= 4
      ? "Já foram muitas mensagens: encerre agora, dizendo que o time chama pela manhã. Se o cliente acabou de corrigir algo, confirme na mesma mensagem o que você entendeu, com as palavras dele, antes de encerrar."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const mensagens = agruparFalas(opts.historico);

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

// Resumo para o time ler de manha antes de mandar a primeira mensagem:
// o que o lead quer, o contexto e o que ainda falta perguntar.
const SISTEMA_RESUMO = `Você resume, para o vendedor da SimpleDEV, uma conversa de WhatsApp que o assistente automático teve com um lead fora do horário.

Um lead é qualificado quando atende às três condições: (1) quer desenvolver um app, sistema ou plataforma real que a SimpleDEV faz (não é aposta, pornografia, hack nem pirataria); (2) tem orçamento, ou aceita investir a partir de R$ 20 mil; (3) quer começar agora ou nos próximos 30 dias.

Escreva em português, em no máximo 6 linhas curtas, sem markdown, neste formato:
Quer: (o que precisa desenvolver, nas palavras do cliente)
Orçamento: (o valor que ele disse, ou como reagiu aos R$ 20 mil)
Quando começa: (o que ele disse, ou o que veio no formulário)
Contexto: (empresa em operação ou projeto novo, segmento, em uma linha)
Avaliação do bot: Qualificado / Não qualificado (motivo) / Incompleto (o que falta saber)

Se uma informação não apareceu, escreva "não disse". Não invente nada. A avaliação é uma sugestão: quem confirma é o time.`;

export async function gerarResumo(historico: Fala[]): Promise<string | null> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave || historico.length === 0) return null;

  const conversa = historico
    .map((f) => `${f.autor === "cliente" ? "Cliente" : "Assistente"}: ${f.texto}`)
    .join("\n");

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
        max_tokens: 250,
        system: SISTEMA_RESUMO,
        messages: [{ role: "user", content: conversa }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const texto = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    return texto || null;
  } catch {
    return null;
  }
}
