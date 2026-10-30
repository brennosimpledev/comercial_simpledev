// Feriados nacionais e os pontos facultativos que o comercial nao trabalha.
// Fora da agenda do bot, dos lembretes e da regua de follow-up. Em 30/10 o
// bot remarcou um cliente para 02/11 (Finados) mesmo com o cliente
// perguntando se era feriado.
//
// Datas moveis (Carnaval, Sexta-feira Santa, Corpus Christi) por ano;
// atualizar no fim de 2027.

const FERIADOS = new Set([
  // 2026
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01",
  "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20",
  "2026-12-24", "2026-12-25", "2026-12-31",
  // 2027
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-04-21", "2027-05-01",
  "2027-05-27", "2027-09-07", "2027-10-12", "2027-11-02", "2027-11-15", "2027-11-20",
  "2027-12-24", "2027-12-25", "2027-12-31",
]);

/** `ymd` no formato AAAA-MM-DD (data de Brasilia). */
export function ehFeriado(ymd: string) {
  return FERIADOS.has(ymd);
}
