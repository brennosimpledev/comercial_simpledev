// Testa o contrato entre a landing page e o webhook do WhatsApp usando o
// codigo real dos dois lados, nao uma reimplementacao.
//
//   LP  -> monta as linhas de rastreio na mensagem
//   CRM -> le essas linhas de volta em acharRastreioDaLp
//
// Se os dois divergirem, o lead chega sem identificador e a conversao
// nunca sobe. Foi o que aconteceu.

import fs from "node:fs";
import path from "node:path";

const LP = "C:/Users/Brenno/Desktop/projetos/lp-nova/index.html";
const CRM =
  "C:/Users/Brenno/Desktop/projetos/comercial_simpledev/src/app/api/webhook/whatsapp/route.ts";

// ---------- lado do CRM: extrai a funcao real e tira os tipos ----------
const rota = fs.readFileSync(CRM, "utf8");
const ini = rota.indexOf("function acharRastreioDaLp");
const fim = rota.indexOf("\n}\n", ini) + 3;
if (ini < 0 || fim < 3) throw new Error("nao achei acharRastreioDaLp");

let fonte = rota.slice(ini, fim);
// Remove as anotacoes de tipo para poder executar como JS puro.
fonte = fonte
  .replace("function acharRastreioDaLp(texto: string | null): {", "function acharRastreioDaLp(texto) { /*")
  .replace("} {", "*/")
  .replace("const achado: Record<string, string> = {};", "const achado = {};");

const acharRastreioDaLp = new Function(fonte + "\nreturn acharRastreioDaLp;")();

// ---------- lado da LP: reproduz a montagem a partir do fonte real ----------
const lp = fs.readFileSync(LP, "utf8");

function montarMensagem(sessao) {
  // Mesma expressao que esta no index.html, lida de la para nao divergir.
  const trecho = lp.slice(
    lp.indexOf("const _idClique = "),
    lp.indexOf(".join('');") + 10
  );
  if (!trecho.includes("_idClique")) throw new Error("nao achei o rastreio na LP");

  const sessionStorage = { getItem: (k) => sessao[k] ?? null };
  const corpo = new Function(
    "sessionStorage",
    trecho + "\nreturn rastreio;"
  )(sessionStorage);

  return [
    "Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.",
    "",
    "work_email: teste@empresa.com.br",
    "full_name: Fulano de Tal",
    "phone_number: +5562999999999",
    "orçamento_estimado: R$ 20.000 a R$ 50.000" + corpo,
  ].join("\n");
}

// ---------- casos ----------
const casos = [
  {
    nome: "clique do Google no Android/desktop (gclid)",
    sessao: { _sd_gclid: "Cj0KCQiA_TESTE_GCLID_123" },
    espera: { daLp: true, gclid: "Cj0KCQiA_TESTE_GCLID_123" },
  },
  {
    nome: "clique do Google no iOS vindo de app (gbraid)",
    sessao: { _sd_gbraid: "0AAAAA_TESTE_GBRAID_456" },
    espera: { daLp: true, gbraid: "0AAAAA_TESTE_GBRAID_456" },
  },
  {
    nome: "clique do Google no iOS na web (wbraid)",
    sessao: { _sd_wbraid: "Cj0KCQ_TESTE_WBRAID_789" },
    espera: { daLp: true, wbraid: "Cj0KCQ_TESTE_WBRAID_789" },
  },
  {
    nome: "trafego organico pela LP (sem identificador)",
    sessao: {},
    espera: { daLp: true },
  },
];

let falhas = 0;

for (const caso of casos) {
  const msg = montarMensagem(caso.sessao);
  const lido = acharRastreioDaLp(msg);

  const erros = [];
  if (lido.daLp !== caso.espera.daLp) {
    erros.push(`daLp=${lido.daLp}, esperado ${caso.espera.daLp}`);
  }
  for (const k of ["gclid", "gbraid", "wbraid"]) {
    const esp = caso.espera[k];
    if (lido[k] !== esp) erros.push(`${k}=${lido[k]}, esperado ${esp}`);
  }

  if (erros.length) {
    falhas++;
    console.log(`FALHOU  ${caso.nome}`);
    erros.forEach((e) => console.log(`        ${e}`));
    console.log("        mensagem:", JSON.stringify(msg.split("\n").slice(-3)));
  } else {
    const id =
      lido.gclid ?? lido.gbraid ?? lido.wbraid ?? "(nenhum, como esperado)";
    console.log(`ok      ${caso.nome} -> ${id}`);
  }
}

// ---------- o formulario da Meta nao pode ser confundido com a LP ----------
const meta = [
  "Novo lead!",
  "work_email: alguem@empresa.com",
  "full_name: Beltrano",
  "phone_number: +5511988887777",
].join("\n");
const lidoMeta = acharRastreioDaLp(meta);
if (lidoMeta.daLp) {
  falhas++;
  console.log("FALHOU  formulario da Meta foi classificado como vindo da LP");
} else {
  console.log("ok      formulario da Meta continua nao sendo confundido com a LP");
}

console.log(`\n${casos.length + 1} casos, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
