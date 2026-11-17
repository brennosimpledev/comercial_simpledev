"use client";

// Periodo da tela de Leads: atalhos (7, 15, 30, 60, 90 dias, este mes, mes
// passado) e, se precisar, datas a mao. Os atalhos contam ate hoje no
// horario de Brasilia e se recalculam sozinhos a cada dia.

export type Atalho = "hoje" | "7d" | "15d" | "30d" | "mes" | "mes_passado" | "60d" | "90d" | "personalizado";

export const ATALHOS: { v: Atalho; rotulo: string }[] = [
  { v: "hoje", rotulo: "Hoje" },
  { v: "7d", rotulo: "7 dias" },
  { v: "15d", rotulo: "15 dias" },
  { v: "30d", rotulo: "30 dias" },
  { v: "mes", rotulo: "Este mês" },
  { v: "mes_passado", rotulo: "Mês passado" },
  { v: "60d", rotulo: "Bimestre" },
  { v: "90d", rotulo: "Trimestre" },
  { v: "personalizado", rotulo: "Personalizado" },
];

// "AAAA-MM-DD" de hoje em Brasilia (UTC-3, sem horario de verao).
export function hojeBR() {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

function somarDias(dia: string, n: number) {
  return new Date(new Date(`${dia}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export function intervaloDoAtalho(a: Exclude<Atalho, "personalizado">): { de: string; ate: string } {
  const h = hojeBR();
  const dias: Partial<Record<Atalho, number>> = { hoje: 1, "7d": 7, "15d": 15, "30d": 30, "60d": 60, "90d": 90 };
  if (dias[a]) return { de: somarDias(h, -(dias[a]! - 1)), ate: h };
  const inicioMes = `${h.slice(0, 8)}01`;
  if (a === "mes") return { de: inicioMes, ate: h };
  // Mes passado: do dia 1 ao ultimo dia dele.
  const fimAnterior = somarDias(inicioMes, -1);
  return { de: `${fimAnterior.slice(0, 8)}01`, ate: fimAnterior };
}

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) !== hojeBR().slice(0, 4) ? `/${d.slice(2, 4)}` : ""}`;

export function PeriodoFiltro({
  atalho,
  de,
  ate,
  onAtalho,
  onDatas,
}: {
  atalho: Atalho;
  de: string;
  ate: string;
  onAtalho: (a: Atalho) => void;
  onDatas: (de: string, ate: string) => void;
}) {
  const dias = Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  const campo =
    "rounded-lg border border-white/10 bg-[#0b2a49] px-2 py-1 text-sm text-slate-100 outline-none focus:border-brand [color-scheme:dark]";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5">
        {ATALHOS.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onAtalho(o.v)}
            aria-pressed={atalho === o.v}
            className={
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand " +
              (atalho === o.v
                ? "border-brand bg-brand/15 text-white"
                : "border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200")
            }
          >
            {o.rotulo}
          </button>
        ))}
      </div>

      {atalho === "personalizado" ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="date" value={de} max={ate} onChange={(e) => e.target.value && onDatas(e.target.value, ate)} className={campo} aria-label="De" />
          <span>a</span>
          <input type="date" value={ate} min={de} onChange={(e) => e.target.value && onDatas(de, e.target.value)} className={campo} aria-label="Até" />
        </div>
      ) : (
        <span className="text-xs tabular-nums text-slate-500">
          {de === ate ? ddmm(de) : `${ddmm(de)} a ${ddmm(ate)}`} · {dias} {dias === 1 ? "dia" : "dias"}
        </span>
      )}
    </div>
  );
}
