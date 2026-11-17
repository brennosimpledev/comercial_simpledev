"use client";

import { useEffect, useRef, useState } from "react";

// Grafico de area de uma serie, em SVG sem libs. Desenha em pixels reais
// (mede a largura), entao bolinhas e texto nao distorcem. Valor null vira
// buraco na linha (ex.: custo por reuniao numa semana sem reuniao).

export type Ponto = { rotulo: string; titulo: string; valor: number | null; nota?: string };

const COR = "#00B2FF";

// Passo "redondo" do eixo: 1, 2, 2.5 ou 5 x 10^n.
function passoBonito(bruto: number) {
  if (bruto <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / base;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * base;
}

export function FunilChart({
  pontos,
  formatar,
  inteiro,
}: {
  pontos: Ponto[];
  formatar: (v: number) => string;
  inteiro?: boolean;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [ativo, setAtivo] = useState<number | null>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const esq = 64;
  const dir = 16;
  const topo = 12;
  const base = 28;

  const valores = pontos.map((p) => p.valor).filter((v): v is number => v !== null);
  const maxBruto = Math.max(0, ...valores);
  let passo = passoBonito(maxBruto / 4);
  if (inteiro) passo = Math.max(1, Math.ceil(passo));
  const max = Math.max(passo, Math.ceil(maxBruto / passo) * passo);
  const marcas: number[] = [];
  for (let v = 0; v <= max + passo / 2; v += passo) marcas.push(v);

  const n = pontos.length;
  const x = (i: number) => (n <= 1 ? (esq + W - dir) / 2 : esq + (i * (W - esq - dir)) / (n - 1));
  const y = (v: number) => topo + (1 - v / max) * (H - topo - base);

  // Trechos continuos (sem null) viram linha + area.
  const trechos: { i: number; v: number }[][] = [];
  let atual: { i: number; v: number }[] = [];
  pontos.forEach((p, i) => {
    if (p.valor === null) {
      if (atual.length) trechos.push(atual);
      atual = [];
    } else atual.push({ i, v: p.valor });
  });
  if (atual.length) trechos.push(atual);

  // Rotulos do eixo X sem encavalar: no maximo um a cada ~56px.
  const cada = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - esq - dir) / 56))));

  function aoMover(e: React.PointerEvent<SVGRectElement>) {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left + esq;
    const i = n <= 1 ? 0 : Math.round(((px - esq) / (W - esq - dir)) * (n - 1));
    setAtivo(Math.min(n - 1, Math.max(0, i)));
  }

  const p = ativo !== null ? pontos[ativo] : null;

  return (
    <div ref={caixa} className="relative w-full select-none">
      <svg width={W} height={H} className="block" role="img" aria-label="Evolução no período">
        <defs>
          <linearGradient id="funilArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COR} stopOpacity="0.32" />
            <stop offset="100%" stopColor={COR} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {marcas.map((t) => (
          <g key={t}>
            <line x1={esq} x2={W - dir} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <text x={esq - 8} y={y(t) + 4} fontSize={11} fill="#94a3b8" textAnchor="end" className="tabular-nums">
              {formatar(t)}
            </text>
          </g>
        ))}

        {trechos.map((t, k) => {
          const linha = t.map((q) => `${x(q.i)},${y(q.v)}`).join(" ");
          const area = `${x(t[0].i)},${y(0)} ${linha} ${x(t[t.length - 1].i)},${y(0)}`;
          return (
            <g key={k}>
              <polygon points={area} fill="url(#funilArea)" />
              <polyline points={linha} fill="none" stroke={COR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}

        {pontos.map((q, i) =>
          q.valor === null ? null : (
            <circle key={i} cx={x(i)} cy={y(q.valor)} r={ativo === i ? 5 : 3.5} fill={COR} stroke="#0f2a4a" strokeWidth={2} />
          )
        )}

        {pontos.map((q, i) =>
          i % cada === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 8} fontSize={11} fill="#94a3b8" textAnchor="middle">
              {q.rotulo}
            </text>
          ) : null
        )}

        {ativo !== null && (
          <line x1={x(ativo)} x2={x(ativo)} y1={topo} y2={H - base} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        )}

        {/* Area de toque maior que a marca: o grafico todo responde. */}
        <rect
          x={esq}
          y={0}
          width={Math.max(0, W - esq - dir)}
          height={H}
          fill="transparent"
          onPointerMove={aoMover}
          onPointerDown={aoMover}
          onPointerLeave={() => setAtivo(null)}
        />
      </svg>

      {p && ativo !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-white/10 bg-[#0b2a49] px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(x(ativo) - 80, 0), W - 170),
            width: 160,
          }}
        >
          <div className="text-slate-400">{p.titulo}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-white">{p.valor === null ? "—" : formatar(p.valor)}</div>
          {p.nota && <div className="mt-0.5 text-[11px] text-slate-500">{p.nota}</div>}
        </div>
      )}
    </div>
  );
}
