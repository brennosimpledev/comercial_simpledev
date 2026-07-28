"use client";

// Grafico de area simples em SVG (sem libs externas).
export function LeadsChart({
  points,
}: {
  points: { label: string; value: number }[];
}) {
  const W = 1000;
  const H = 240;
  const padX = 40;
  const padY = 20;

  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;

  const x = (i: number) =>
    n <= 1 ? padX : padX + (i * (W - padX * 2)) / (n - 1);
  const y = (v: number) => H - padY - (v * (H - padY * 2)) / maxVal;

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area =
    `${padX},${H - padY} ` +
    points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ") +
    ` ${x(n - 1)},${H - padY}`;

  // Marcas do eixo Y (0..max).
  const ticks = Array.from({ length: maxVal + 1 }, (_, i) => i).filter(
    (t) => maxVal <= 6 || t % Math.ceil(maxVal / 6) === 0
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full min-w-[600px]"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="leadArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padX}
              x2={W - padX}
              y1={y(t)}
              y2={y(t)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={8} y={y(t) + 4} fontSize={12} fill="#94a3b8">
              {t}
            </text>
          </g>
        ))}

        <polygon points={area} fill="url(#leadArea)" />
        <polyline
          points={line}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="#3b82f6" />
            <text
              x={x(i)}
              y={H - 4}
              fontSize={11}
              fill="#94a3b8"
              textAnchor="middle"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
