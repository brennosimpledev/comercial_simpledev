import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cerebroAtivo, gerarResposta, gerarResumo } from "@/lib/bot/cerebro";
import { horariosLivres } from "@/lib/agenda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Simulacao do bot com clientes de mentira — somente leitura.
//
//   GET ?secret=...                 -> lista os cenarios
//   GET ?secret=...&cenario=livia   -> roda um cenario
//   GET ?secret=...&cenario=todos   -> roda todos (em paralelo)
//
// O cliente fala as linhas do roteiro (tiradas das conversas reais do fim
// de semana de 14-15/11/2026); o bot responde de verdade, com o prompt
// atual, e as respostas dele entram no historico. No fim, gera o resumo e
// confere o que se esperava. Nao envia nada pelo WhatsApp, nao grava nada
// no CRM e nao marca reuniao (a ferramenta de agendar so e registrada).

type Espera = "agenda" | "desqualifica" | "fila_sdr";

type Cenario = {
  nome: string;
  baseado_em: string;
  espera: Espera;
  // O bot tem que apresentar o piso de R$ 20 mil em algum momento.
  piso?: boolean;
  // Caso cinza (empresa em operacao que nao recusou o piso): agenda, mas
  // nao pode virar "Lead Qualificado" (VALOR_NATURAL: nao).
  cinza?: boolean;
  falas: string[];
};

const FORM = (o: { nome: string; situacao: string; estagio: string; quando: string; relacao: string }) =>
  `Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.\n\nFull name: ${o.nome}\nQual dessas situações melhor descreve o que precisa hoje?: ${o.situacao}\nEm qual estágio você se encontra hoje?: ${o.estagio}\nQuando você pretende iniciar este projeto?: ${o.quando}\nEste projeto está relacionado a que?: ${o.relacao}`;

const CENARIOS: Record<string, Cenario> = {
  speaking_organ: {
    nome: "Marcos",
    baseado_em: "Speaking Organ: produto já opera, perguntou a sede no meio e depois disse 'se encaixa'",
    espera: "agenda",
    piso: true,
    falas: [
      FORM({ nome: "Marcos Speaking", situacao: "Automatizar processos que já existem", estagio: "Sei o que preciso e quero estruturar melhor", quando: "Nos próximos 3 meses", relacao: "Crescimento/Escala do negócio" }),
      "Sistema de Alfabetização para idioma inglês. Produto já em funcionamento, mas manual.",
      "Depende de alguns fatores que envolvem a capacidade da Simple Dev de completar o sistema fundacional manual e em seguida a expansão",
      "Onde é a sede da Simple Dev?",
      "Se encaixa.",
      "O produto já fatura, temos alunos pagando hoje. Queremos começar o quanto antes.",
      "Pode ser o primeiro horário que você falou.",
    ],
  },
  luiz_desvia_do_valor: {
    nome: "Luiz",
    baseado_em: "Luiz Carlos: desviou do valor, mas já opera a ferramenta e disse ok ao piso (caso cinza, desde 17/11 agenda)",
    espera: "agenda",
    piso: true,
    cinza: true,
    falas: [
      FORM({ nome: "Luiz Carlos", situacao: "Automatizar processos que já existem", estagio: "Sei o que preciso e quero estruturar melhor", quando: "O quanto antes", relacao: "Crescimento/Escala do negócio" }),
      "Uma extensão de navegador web ou mobile",
      "Leitura de gráficos e interpretação para entradas no mercado trader",
      "Eu já tenho o projeto, linhas de código e tudo pronto, preciso ampliar para mais corretoras",
      "Ok, sem problema",
      "É da minha empresa, já opero com a ferramenta e vendo acesso pra outros traders",
      "Pode ser o primeiro horário",
    ],
  },
  sonia_duas_ideias: {
    nome: "Sonia",
    baseado_em: "Sônia: duas ideias, o bot encerrou sem falar de valor",
    espera: "fila_sdr",
    piso: true,
    falas: [
      FORM({ nome: "Sonia Coiado", situacao: "Tenho uma ideia de app/sistema", estagio: "Sei o que preciso e quero estruturar melhor", quando: "Sem prazo definido", relacao: "Validação de uma nova ideia" }),
      "App para imobiliária com hospedagem de corretores com assinatura. App roteiro de viagens dentro do Brasil",
      "O da imobiliária",
      "Ok",
      "Apenas para entender melhor no momento",
    ],
  },
  jose_surpresa_com_preco: {
    nome: "José",
    baseado_em: "José Carlos: 'nossa, pensei que era mais em conta'",
    espera: "desqualifica",
    piso: true,
    falas: [
      FORM({ nome: "José Carlos Melo", situacao: "Preciso desenvolver algo rápido com acompanhamento", estagio: "Sei o que preciso e quero estruturar melhor", quando: "O quanto antes", relacao: "Redução de custo/Ganho de eficiência" }),
      "preciso desenvolver um sistema de gestao de loja",
      "estou pesquisando valores com algumas empresas",
      "nossa !!! desculpe pensei que era mais em conta",
      "meu negocio e pequeno, tenho um quiosque em shopping",
    ],
  },
  livia_3_mil: {
    nome: "Livia",
    baseado_em: "Lívia: 'uns 3 mil'",
    espera: "desqualifica",
    falas: [
      FORM({ nome: "Livia Maria", situacao: "Preciso desenvolver algo rápido com acompanhamento", estagio: "Tenho clareza e quero executar", quando: "O quanto antes", relacao: "Validação de uma nova ideia" }),
      "Aplicativo de clube de leitura",
      "Uns 3 mil",
    ],
  },
  anderson_muito_caro: {
    nome: "Anderson",
    baseado_em: "Anderson: medo de roubarem a ideia, sem empresa, 'muito caro'",
    espera: "desqualifica",
    piso: true,
    falas: [
      FORM({ nome: "Anderson Luiz", situacao: "Tenho uma ideia de app/sistema", estagio: "Tenho clareza e quero executar", quando: "O quanto antes", relacao: "Validação de uma nova ideia" }),
      "🎙️ Bom dia, com quem eu falo? Como eu faria para ter segurança de que vou falar a minha ideia e vocês não vão roubar a ideia?",
      "Não eu não tenho empresa, só tive uma ideia de aplicativo e queria saber se é viável",
      "Na verdade eu quero ter uma ideia de quanto custaria",
      "Muito caro",
    ],
  },
  lucas_5_mil: {
    nome: "Lucas",
    baseado_em: "Lucas: 'até 5 mil reais'",
    espera: "desqualifica",
    falas: [
      FORM({ nome: "Lucas Nascimento", situacao: "Automatizar processos que já existem", estagio: "Apenas validando possibilidades", quando: "Nos próximos 3 meses", relacao: "Validação de uma nova ideia" }),
      "Hoje faço arbitragem de criptomoedas, quero automatizar o processo",
      "ate 5 mil reais",
      "ok",
    ],
  },
  eduardo_sem_recurso: {
    nome: "Eduardo",
    baseado_em: "Eduardo Bastos: 'orçamento apertado', 'muito acima das minhas possibilidades'",
    espera: "desqualifica",
    piso: true,
    falas: [
      FORM({ nome: "Eduardo Bastos", situacao: "Tenho uma ideia de app/sistema", estagio: "Tenho clareza e quero executar", quando: "Nos próximos 3 meses", relacao: "Validação de uma nova ideia" }),
      "É uma ferramenta de avaliação gerencial com IA. O cliente responde perguntas e gera um relatório",
      "Não faço a menor ideia. Uma coisa é certa, o orçamento está apertado",
      "No momento sem chance, muito acima das minhas possibilidades",
    ],
  },
  edeval_negociar: {
    nome: "Edeval",
    baseado_em: "Edeval: empresa operando, 'podemos negociar valor e condições de pagamento' (caso cinza, desde 17/11 agenda)",
    espera: "agenda",
    piso: true,
    cinza: true,
    falas: [
      FORM({ nome: "Edeval Moreth", situacao: "Automatizar processos que já existem", estagio: "Sei o que preciso e quero estruturar melhor", quando: "O quanto antes", relacao: "Necessidade operacional específica" }),
      "Preciso de um atendimento automatizado 24h no WhatsApp que envia cotação e segunda via de boleto para meus clientes",
      "Pra mim ter ideia vou precisar de uma cotação",
      "Podemos negociar valor e condições de pagamento",
      "Sim, é da minha empresa, uma distribuidora que já opera há 10 anos",
      "Pode ser o primeiro horário",
    ],
  },
  reger_projeto_pessoal: {
    nome: "Reger",
    baseado_em: "Reger: projeto pessoal, sem negócio, 'não tenho base'",
    espera: "fila_sdr",
    falas: [
      FORM({ nome: "Reger", situacao: "Tenho uma ideia de app/sistema", estagio: "Já iniciei algo e busco ajustar/evoluir", quando: "Dentro de 30 dias", relacao: "Crescimento/Escala do negócio" }),
      "meu projeto é um ecossistema de IAs, tô com o mapa todo mas tô batendo a cabeça, pouca experiência",
      "pra mim",
      "não, é um projeto que cria apks, softwares, sites etc",
      "não tenho base sabe, tô buscando informação",
    ],
  },
  leandro_clinica: {
    nome: "Leandro",
    baseado_em: "Leandro (RX Norte): clínica operando, 'o valor faz sentido'",
    espera: "agenda",
    piso: true,
    falas: [
      FORM({ nome: "Leandro Santana", situacao: "Automatizar processos que já existem", estagio: "Já iniciei algo e busco ajustar/evoluir", quando: "Nos próximos 3 meses", relacao: "Necessidade operacional específica" }),
      "Enviar as imagens de exames de raio-x, mamografia e tomografia do PACS em nuvem da minha clínica para os pacientes via WhatsApp",
      "Não tenho ideia de valor mas tenho um vídeo curto mostrando como seria",
      "O valor faz sentido.",
      "Sim, é para a clínica, a RX Norte, que já atende há anos",
      "Pode ser o primeiro horário",
    ],
  },
  empresa_ideal: {
    nome: "Fernando",
    baseado_em: "Perfil Fernando S.A.: empresa grande, valor natural",
    espera: "agenda",
    falas: [
      FORM({ nome: "Fernando Sortino", situacao: "Automatizar processos que já existem", estagio: "Sei o que preciso e quero estruturar melhor", quando: "Dentro de 30 dias", relacao: "Redução de custo/Ganho de eficiência" }),
      "Uma plataforma de gestão comercial e de projetos pra nossa empresa, hoje é tudo em planilha",
      "Separamos algo entre 40 e 60 mil",
      "Sim, é da empresa, somos uma indústria com 80 funcionários",
      "Pode ser o segundo horário",
    ],
  },
  leandro_erp: {
    nome: "Leandro",
    baseado_em: "Leandro Inácio (16/11): assumir o ERP e PDV da Videira Atacado de Bebidas; 'pode ser' ao piso é aceitação natural",
    espera: "agenda",
    piso: true,
    falas: [
      FORM({ nome: "Leandro Inácio", situacao: "Automatizar processos que já existem", estagio: "Já iniciei algo e busco ajustar/evoluir", quando: "O quanto antes", relacao: "Necessidade operacional específica" }),
      "Estamos buscando uma empresa para assumir tecnicamente, estabilizar e continuar o desenvolvimento do ERP e PDV Caravela, criado para uso próprio da Videira Atacado de Bebidas. Já tem código, banco, PDV, retaguarda e estoque",
      "Depende do escopo, precisamos de uma proposta",
      "Pode ser, o importante é estabilizar logo",
      "Pode ser o primeiro horário",
    ],
  },
  vou_avaliar: {
    nome: "Paula",
    baseado_em: "Hesitação sem dizer que não tem e sem negócio por trás: 'vou avaliar'",
    espera: "fila_sdr",
    piso: true,
    falas: [
      FORM({ nome: "Paula Souza", situacao: "Tenho uma ideia de app/sistema", estagio: "Sei o que preciso e quero estruturar melhor", quando: "Nos próximos 3 meses", relacao: "Crescimento/Escala do negócio" }),
      "Um app de agendamento para salões de beleza, é uma ideia minha, ainda não tenho empresa",
      "Não sei ainda",
      "Hmm, vou avaliar, depende das condições",
    ],
  },
};

const OFERECEU_HORARIO = /\b(às|as)\s+\d{1,2}h\b/i;

async function rodar(chave: string, horarios: Awaited<ReturnType<typeof horariosLivres>>) {
  const c = CENARIOS[chave];
  const historico: { autor: "cliente" | "nos"; texto: string }[] = [];
  const conversa: string[] = [];
  let etapa = 0;
  let agendou: string | null = null;
  let ofereceu = false;

  for (const fala of c.falas) {
    historico.push({ autor: "cliente", texto: fala });
    conversa.push(`CLIENTE: ${fala.startsWith("Olá! Preenchi") ? "[formulário]" : fala}`);
    const r = await gerarResposta({ nome: c.nome, historico, etapa, horarios });
    if (r.agendar) {
      agendou = horarios.find((h) => h.iso === r.agendar)?.rotulo ?? r.agendar;
      conversa.push(`BOT: [MARCARIA A REUNIÃO: ${agendou}]`);
      historico.push({ autor: "nos", texto: `Prontinho! Sua conversa ficou marcada para ${agendou}.` });
      break;
    }
    const texto = r.texto ?? "";
    conversa.push(`BOT: ${texto || "[sem resposta]"}`);
    if (!texto) break;
    if (OFERECEU_HORARIO.test(texto)) ofereceu = true;
    historico.push({ autor: "nos", texto });
    etapa++;
  }

  const resumo = await gerarResumo(historico);
  const desqualificaria = resumo?.codigo === "nao_qualificado" && Boolean(resumo?.semDinheiro);
  const falouPiso = historico.some((f) => f.autor === "nos" && /20\s*mil/i.test(f.texto));

  const checagens: Record<string, boolean> = {};
  if (c.espera === "agenda") checagens["ofereceu horário ou marcou"] = ofereceu || Boolean(agendou);
  if (c.espera === "desqualifica") {
    checagens["desqualificaria sozinho"] = desqualificaria;
    checagens["não ofereceu horário"] = !ofereceu && !agendou;
  }
  if (c.espera === "fila_sdr") {
    checagens["não ofereceu horário"] = !ofereceu && !agendou;
    checagens["não desqualificou"] = !desqualificaria;
  }
  if (c.piso) checagens["apresentou o piso de R$ 20 mil"] = falouPiso;
  if (c.cinza) checagens["não vira Lead Qualificado (valor não natural)"] = resumo?.valorNatural === false;

  return {
    cenario: chave,
    baseado_em: c.baseado_em,
    esperado: c.espera,
    passou: Object.values(checagens).every(Boolean),
    checagens,
    codigo: resumo?.codigo ?? null,
    sem_dinheiro: resumo?.semDinheiro ?? null,
    valor_natural: resumo?.valorNatural ?? null,
    conversa,
  };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cerebroAtivo()) return NextResponse.json({ erro: "ANTHROPIC_API_KEY não configurada." });

  const cenario = q.get("cenario");
  if (!cenario) {
    return NextResponse.json({
      cenarios: Object.entries(CENARIOS).map(([k, c]) => ({ cenario: k, baseado_em: c.baseado_em, esperado: c.espera })),
    });
  }
  const chaves = cenario === "todos" ? Object.keys(CENARIOS) : [cenario];
  if (chaves.some((k) => !CENARIOS[k])) return NextResponse.json({ error: "cenário desconhecido" }, { status: 400 });

  const horarios = await horariosLivres(createAdminClient());
  const resultados = await Promise.all(chaves.map((k) => rodar(k, horarios)));
  return NextResponse.json({
    passaram: resultados.filter((r) => r.passou).length,
    total: resultados.length,
    resultados,
  });
}
