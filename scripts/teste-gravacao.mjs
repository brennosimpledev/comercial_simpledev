// Guarda contra patch aplicado pela metade.
//
// O teste de contrato cobria so o parser. Um patch anterior falhou no meio:
// o extrator foi reescrito e o insert do lead ficou para tras, ainda
// gravando apenas gclid. Compilou, passou no teste, e nao gravava nada.
// Estas checagens olham o que o insert realmente escreve.

import fs from "node:fs";

const CRM = "C:/Users/Brenno/Desktop/projetos/comercial_simpledev";

const arquivos = {
  whatsapp: fs.readFileSync(`${CRM}/src/app/api/webhook/whatsapp/route.ts`, "utf8"),
  mapper: fs.readFileSync(`${CRM}/src/lib/mappers/webhook-lead.ts`, "utf8"),
  meta: fs.readFileSync(`${CRM}/src/app/api/webhook/meta/route.ts`, "utf8"),
  report: fs.readFileSync(`${CRM}/src/lib/conversions/report.ts`, "utf8"),
  ads: fs.readFileSync(`${CRM}/src/lib/google/ads.ts`, "utf8"),
};

const checagens = [
  // ---- webhook do WhatsApp ----
  ["whatsapp", "gbraid: rastreio.gbraid", "insert grava gbraid"],
  ["whatsapp", "wbraid: rastreio.wbraid", "insert grava wbraid"],
  ["whatsapp", "meta_lead_id: rastreio.leadgenId", "insert grava leadgen_id da Meta"],
  ["whatsapp", "origem: doGoogle", "origem considera os tres identificadores"],
  ["whatsapp", "utm_medium: doGoogle || daMeta", "utm_medium considera os tres"],

  // ---- mapper da landing page ----
  ["mapper", "gbraid: clean(payload.gbraid)", "mapper grava gbraid"],
  ["mapper", "wbraid: clean(payload.wbraid)", "mapper grava wbraid"],
  ["mapper", "clean(payload.gbraid) || clean(payload.wbraid)", "origem considera iOS"],

  // ---- orquestrador de conversoes ----
  ["report", "gbraid, wbraid", "select traz os campos novos"],
  ["report", 'if (lead.gbraid) return { valor: lead.gbraid, tipo: "gbraid" }', "escolhe gbraid"],
  ["report", 'if (lead.wbraid) return { valor: lead.wbraid, tipo: "wbraid" }', "escolhe wbraid"],
  ["report", "id_tipo: args.idTipo", "registra qual identificador foi usado"],

  // ---- webhook da Meta: nao pode duplicar lead ----
  ["meta", "brCanonical(c.whatsapp) === canon", "webhook da Meta casa por telefone"],
  ["meta", "meta_lead_id: leadgenId,", "preenche o leadgen_id no lead existente"],
  ["meta", `.is("meta_lead_id", null)`, "nao sobrescreve identificador existente"],

  // ---- envio ao Google ----
  ["ads", "adIdentifiers: { [opts.idTipo]: opts.identificador }", "adIdentifiers usa o tipo certo"],
];

let falhas = 0;
for (const [arq, trecho, nome] of checagens) {
  if (arquivos[arq].includes(trecho)) {
    console.log(`ok      ${nome}`);
  } else {
    falhas++;
    console.log(`FALHOU  ${nome}`);
    console.log(`        esperado em ${arq}: ${trecho}`);
  }
}

// O select do report precisa trazer os dois campos nas DUAS consultas,
// senao o fechamento pendente decide sem eles.
const selects = arquivos.report.split("gbraid, wbraid").length - 1;
if (selects >= 2) {
  console.log(`ok      os dois selects trazem gbraid/wbraid (${selects})`);
} else {
  falhas++;
  console.log(`FALHOU  so ${selects} select traz gbraid/wbraid, esperado 2`);
}

console.log(`\n${checagens.length + 1} checagens, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
