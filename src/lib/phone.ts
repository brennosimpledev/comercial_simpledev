// Utilitarios de telefone (Brasil).

export function brDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

// Forma canonica: DDD (2) + 8 digitos do assinante.
// Remove o codigo do pais (55) e o "9" extra dos celulares, de modo que
// "5562988887777", "62988887777" e "6288887777" viram todos "6288887777".
export function brCanonical(raw: string | null | undefined): string {
  let d = brDigits(raw);
  if (!d) return "";
  // Remove DDI 55 quando o numero e claramente internacional (12-13 digitos).
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);

  if (d.length >= 11) {
    // DDD + assinante de 9 digitos (com o 9 na frente).
    const ddd = d.slice(0, 2);
    let sub = d.slice(2);
    if (sub.length === 9 && sub.startsWith("9")) sub = sub.slice(1);
    return ddd + sub.slice(-8);
  }
  if (d.length === 10) {
    // DDD + 8 (fixo ou celular antigo sem o 9).
    return d;
  }
  // Sem DDD identificavel: usa os ultimos 8 como fallback.
  return d.slice(-8);
}

// Ultimos 8 digitos (prefiltro barato para buscar candidatos no banco).
export function last8(raw: string | null | undefined): string {
  return brDigits(raw).slice(-8);
}
