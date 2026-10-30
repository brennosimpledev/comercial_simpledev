// Valor em reais digitado a mao: "12.500,00", "12500.00", "12.500", "50k",
// "50 mil", "R$ 17.500". Devolve null para vazio ou zero.
export function parseValor(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const bruto = (v ?? "").trim().toLowerCase();
  if (!bruto) return null;
  const mil = /\d\s*(k|mil)\b/.test(bruto) ? 1000 : 1;
  let s = bruto.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // Formato brasileiro: ponto separa milhar, virgula separa centavos.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "12.500" ou "1.250.000": so separador de milhar.
    s = s.replace(/\./g, "");
  }
  const n = Number(s) * mil;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
