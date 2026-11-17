"use client";

import { useEffect, useMemo, useState } from "react";
import { metricasMarketing, type Funil, type Marketing } from "@/app/(app)/leads/marketing";
import { FunilChart, type Ponto } from "./FunilChart";

// Funil do periodo, passo a passo: do dinheiro investido na Meta ate o
// contrato fechado. Cada etapa mostra quantos chegaram ali, quanto custou
// cada um e quantos passaram da etapa anterior.

const brl = (v: number, casas = 0) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (v: number) => v.toLocaleString("pt-BR");
const custo = (gasto: number, n: number, casas = 0) => (n > 0 && gasto > 0 ? brl(gasto / n, casas) : "—");
const taxa = (a: number, b: number, casas = 0) =>
  b > 0 ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%` : "—";

type Metrica = "gasto" | "impressoes" | "cliques" | "pessoas" | "conversaram" | "qualificados" | "reunioes" | "realizadas" | "fechados";

type Etapa = {
  metrica: Metrica;
  rotulo: string;
  valor: string;
  custo?: { rotulo: string; valor: string; chave?: boolean };
  passagem?: string;
};

function etapas(f: Funil): Etapa[] {
  return [
    { metrica: "gasto", rotulo: "Investimento", valor: brl(f.gasto) },
    {
      metrica: "impressoes",
      rotulo: "Impressões",
      valor: num(f.impressoes),
      custo: { rotulo: "CPM", valor: custo(f.gasto * 1000, f.impressoes, 2) },
    },
    {
      metrica: "cliques",
      rotulo: "Cliques no link",
      valor: num(f.cliques),
      custo: { rotulo: "CPC", valor: custo(f.gasto, f.cliques, 2) },
      passagem: `CTR ${taxa(f.cliques, f.impressoes, 2)}`,
    },
    {
      metrica: "pessoas",
      rotulo: "Leads",
      valor: num(f.pessoas),
      custo: { rotulo: "por lead", valor: custo(f.gasto, f.pessoas, 2), chave: true },
      passagem: `${taxa(f.pessoas, f.cliques, 1)} dos cliques`,
    },
    {
      metrica: "conversaram",
      rotulo: "Conversaram",
      valor: num(f.conversaram),
      custo: { rotulo: "por conversa", valor: custo(f.gasto, f.conversaram) },
      passagem: `${taxa(f.conversaram, f.pessoas)} dos leads`,
    },
    {
      metrica: "qualificados",
      rotulo: "Qualificados",
      valor: num(f.qualificados),
      custo: { rotulo: "por qualificado", valor: custo(f.gasto, f.qualificados), chave: true },
      passagem: `${taxa(f.qualificados, f.conversaram)} de quem conversou`,
    },
    {
      metrica: "reunioes",
      rotulo: "Reuniões",
      valor: num(f.reunioes),
      custo: { rotulo: "por reunião", valor: custo(f.gasto, f.reunioes), chave: true },
      passagem: `${taxa(f.reunioes, f.pessoas)} dos leads`,
    },
    {
      metrica: "realizadas",
      rotulo: "Realizadas",
      valor: num(f.realizadas),
      custo: { rotulo: "por realizada", valor: custo(f.gasto, f.realizadas) },
      passagem: `${taxa(f.realizadas, f.reunioes)} das marcadas`,
    },
    {
      metrica: "fechados",
      rotulo: "Fechados",
      valor: num(f.fechados),
      custo: { rotulo: "por venda", valor: custo(f.gasto, f.fechados), chave: true },
      passagem: f.valor_fechado > 0 ? `${brl(f.valor_fechado)} · ${(f.valor_fechado / Math.max(f.gasto, 1)).toFixed(1)}x` : `${taxa(f.fechados, f.realizadas)} das realizadas`,
    },
  ];
}

function CartaoEtapa({ e, primeira, marcado, onClick }: { e: Etapa; primeira: boolean; marcado: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={marcado}
      title="Ver no gráfico"
      className={
        "relative flex min-w-0 flex-col rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand " +
        (marcado ? "border-brand bg-brand/10" : "border-white/10 bg-navy-mid hover:border-white/25")
      }
    >
      {!primeira && (
        <span aria-hidden className="absolute -left-[11px] top-1/2 hidden -translate-y-1/2 text-slate-500 lg:block">
          ›
        </span>
      )}
      <div className="truncate text-[11px] uppercase tracking-wide text-slate-400">{e.rotulo}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-white">{e.valor}</div>
      {e.custo && (
        <div className={"mt-1 text-xs tabular-nums " + (e.custo.chave ? "font-semibold text-brand" : "text-slate-300")}>
          {e.custo.valor} <span className="font-normal text-slate-500">{e.custo.rotulo}</span>
        </div>
      )}
      {e.passagem && <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{e.passagem}</div>}
    </button>
  );
}

// O que o grafico mostra para cada etapa: a quantidade, o custo de cada um
// e a taxa de passagem da etapa anterior (null = sem base para calcular).
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const porCabeca = (f: Funil, n: number) => (f.gasto > 0 ? div(f.gasto, n) : null);
const GRAFICO: Record<
  Metrica,
  {
    qtd: (f: Funil) => number;
    custo?: { rotulo: string; v: (f: Funil) => number | null };
    taxa?: { rotulo: string; v: (f: Funil) => number | null };
  }
> = {
  gasto: { qtd: (f) => f.gasto },
  impressoes: { qtd: (f) => f.impressoes, custo: { rotulo: "CPM", v: (f) => (f.gasto > 0 ? div(f.gasto * 1000, f.impressoes) : null) } },
  cliques: {
    qtd: (f) => f.cliques,
    custo: { rotulo: "CPC", v: (f) => porCabeca(f, f.cliques) },
    taxa: { rotulo: "CTR", v: (f) => div(f.cliques, f.impressoes) },
  },
  pessoas: {
    qtd: (f) => f.pessoas,
    custo: { rotulo: "custo por lead", v: (f) => porCabeca(f, f.pessoas) },
    taxa: { rotulo: "% dos cliques", v: (f) => div(f.pessoas, f.cliques) },
  },
  conversaram: {
    qtd: (f) => f.conversaram,
    custo: { rotulo: "custo por conversa", v: (f) => porCabeca(f, f.conversaram) },
    taxa: { rotulo: "% dos leads", v: (f) => div(f.conversaram, f.pessoas) },
  },
  qualificados: {
    qtd: (f) => f.qualificados,
    custo: { rotulo: "custo por qualificado", v: (f) => porCabeca(f, f.qualificados) },
    taxa: { rotulo: "% de quem conversou", v: (f) => div(f.qualificados, f.conversaram) },
  },
  reunioes: {
    qtd: (f) => f.reunioes,
    custo: { rotulo: "custo por reunião", v: (f) => porCabeca(f, f.reunioes) },
    taxa: { rotulo: "% dos leads", v: (f) => div(f.reunioes, f.pessoas) },
  },
  realizadas: {
    qtd: (f) => f.realizadas,
    custo: { rotulo: "custo por realizada", v: (f) => porCabeca(f, f.realizadas) },
    taxa: { rotulo: "% das marcadas", v: (f) => div(f.realizadas, f.reunioes) },
  },
  fechados: {
    qtd: (f) => f.fechados,
    custo: { rotulo: "custo por venda", v: (f) => porCabeca(f, f.fechados) },
    taxa: { rotulo: "% das realizadas", v: (f) => div(f.fechados, f.realizadas) },
  },
};

type Modo = "qtd" | "custo" | "taxa";
type Escala = "dia" | "semana";

function somarFunis(lista: Funil[]): Funil {
  const t = { ...lista[0] };
  for (const f of lista.slice(1)) for (const k of Object.keys(t) as (keyof Funil)[]) t[k] += f[k];
  return t;
}

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

// Dias -> pontos (por dia ou por semana de segunda a domingo).
function agrupar(serie: Marketing["serie"], escala: Escala) {
  if (escala === "dia") {
    return serie.map((s) => {
      const sem = new Date(`${s.dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
      return { rotulo: ddmm(s.dia), titulo: `${sem}, ${ddmm(s.dia)}`, f: s.f, nota: undefined as string | undefined };
    });
  }
  const grupos: { dias: string[]; f: Funil[] }[] = [];
  for (const s of serie) {
    const dow = new Date(`${s.dia}T12:00:00Z`).getUTCDay();
    if (!grupos.length || dow === 1) grupos.push({ dias: [], f: [] });
    grupos[grupos.length - 1].dias.push(s.dia);
    grupos[grupos.length - 1].f.push(s.f);
  }
  return grupos.map((g) => ({
    rotulo: ddmm(g.dias[0]),
    titulo: `Semana de ${ddmm(g.dias[0])} a ${ddmm(g.dias[g.dias.length - 1])}`,
    f: somarFunis(g.f),
    nota: g.dias.length < 7 ? `Semana parcial (${g.dias.length} ${g.dias.length === 1 ? "dia" : "dias"})` : undefined,
  }));
}

function Alternador<T extends string>({
  valor,
  opcoes,
  onChange,
}: {
  valor: T;
  opcoes: { v: T; rotulo: string; off?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={o.off}
          onClick={() => onChange(o.v)}
          aria-pressed={valor === o.v}
          className={
            "rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-30 " +
            (valor === o.v ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")
          }
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

const colunas: { rotulo: string; valor: (a: Funil) => string; chave?: boolean }[] = [
  { rotulo: "Gasto", valor: (a) => brl(a.gasto) },
  { rotulo: "CPM", valor: (a) => custo(a.gasto * 1000, a.impressoes, 2) },
  { rotulo: "Cliques", valor: (a) => num(a.cliques) },
  { rotulo: "CPC", valor: (a) => custo(a.gasto, a.cliques, 2) },
  { rotulo: "CTR", valor: (a) => taxa(a.cliques, a.impressoes, 2) },
  { rotulo: "Leads", valor: (a) => num(a.pessoas) },
  { rotulo: "R$/lead", valor: (a) => custo(a.gasto, a.pessoas, 2), chave: true },
  { rotulo: "Conversaram", valor: (a) => num(a.conversaram) },
  { rotulo: "Qualif.", valor: (a) => num(a.qualificados) },
  { rotulo: "R$/qualif.", valor: (a) => custo(a.gasto, a.qualificados), chave: true },
  { rotulo: "Desqualif.", valor: (a) => num(a.desqualificados) },
  { rotulo: "Reuniões", valor: (a) => num(a.reunioes) },
  { rotulo: "R$/reunião", valor: (a) => custo(a.gasto, a.reunioes), chave: true },
  { rotulo: "Realizadas", valor: (a) => num(a.realizadas) },
  { rotulo: "Fechados", valor: (a) => (a.fechados > 0 ? `${a.fechados} · ${brl(a.valor_fechado)}` : "0") },
];

export function MarketingPanel({ de, ate }: { de: string; ate: string }) {
  const [dados, setDados] = useState<Marketing | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Grafico: qual etapa, o que dela (quantidade, custo, taxa) e por dia/semana.
  const [metrica, setMetrica] = useState<Metrica>("pessoas");
  const [modo, setModo] = useState<Modo>("qtd");
  const [escala, setEscala] = useState<Escala>("dia");
  // Detalhe por anuncio fechado por padrao; lembra a escolha no navegador.
  const [porAnuncio, setPorAnuncio] = useState(false);
  useEffect(() => {
    try {
      setPorAnuncio(localStorage.getItem("sd_marketing_por_anuncio") === "1");
    } catch {}
  }, []);
  function alternarPorAnuncio() {
    const novo = !porAnuncio;
    setPorAnuncio(novo);
    try {
      localStorage.setItem("sd_marketing_por_anuncio", novo ? "1" : "0");
    } catch {}
  }

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(async () => {
      const r = await metricasMarketing(de, ate);
      if (!vivo) return;
      setCarregando(false);
      if ("error" in r) {
        setErro(r.error);
        return;
      }
      setErro(r.erro ?? null);
      setDados(r);
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [de, ate]);

  const t = dados?.total;

  const cfg = GRAFICO[metrica];
  // Etapa sem custo/taxa (ex.: investimento) cai para quantidade.
  const modoVale: Modo = (modo === "custo" && !cfg.custo) || (modo === "taxa" && !cfg.taxa) ? "qtd" : modo;
  const rotuloEtapa = t ? (etapas(t).find((e) => e.metrica === metrica)?.rotulo ?? "") : "";
  const tituloGrafico =
    modoVale === "custo" ? `${rotuloEtapa} · ${cfg.custo!.rotulo}` : modoVale === "taxa" ? `${rotuloEtapa} · ${cfg.taxa!.rotulo}` : rotuloEtapa;
  const grafico = useMemo(() => {
    if (!dados?.serie?.length) return null;
    const conf = GRAFICO[metrica];
    const pontos: Ponto[] = agrupar(dados.serie, escala).map((g) => ({
      rotulo: g.rotulo,
      titulo: g.titulo,
      nota: g.nota,
      valor: modoVale === "custo" ? conf.custo!.v(g.f) : modoVale === "taxa" ? conf.taxa!.v(g.f) : conf.qtd(g.f),
    }));
    const dinheiro = modoVale === "custo" || (modoVale === "qtd" && metrica === "gasto");
    const formatar =
      modoVale === "taxa"
        ? (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: v > 0 && v < 0.1 ? 1 : 0 })}%`
        : dinheiro
          ? (v: number) => brl(v, v > 0 && v < 100 ? 2 : 0)
          : (v: number) => num(Math.round(v));
    return { pontos, formatar, inteiro: !dinheiro && modoVale === "qtd" };
  }, [dados, metrica, modoVale, escala]);

  return (
    <section className="sd-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Funil do período · Meta Ads</h2>
        <span className="text-xs text-slate-500">
          {carregando
            ? "Atualizando…"
            : t
              ? `${num(t.leads_meta)} leads segundo a Meta · ${num(t.desqualificados)} desqualificados (${taxa(t.desqualificados, t.pessoas)})${dados && dados.outras_origens > 0 ? ` · ${dados.outras_origens} de outras origens fora do funil` : ""}`
              : ""}
        </span>
      </div>

      {erro && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{erro}</p>}

      {!t && carregando && <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />}

      {t && dados && (
        <div className={carregando ? "opacity-60 transition" : "transition"}>
          {grafico && (
            <div className="mb-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-200">{tituloGrafico}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Alternador
                    valor={modoVale}
                    onChange={setModo}
                    opcoes={[
                      { v: "qtd", rotulo: "Quantidade" },
                      { v: "custo", rotulo: "Custo", off: !cfg.custo },
                      { v: "taxa", rotulo: "Taxa", off: !cfg.taxa },
                    ]}
                  />
                  <Alternador
                    valor={escala}
                    onChange={setEscala}
                    opcoes={[
                      { v: "dia", rotulo: "Diário" },
                      { v: "semana", rotulo: "Semanal" },
                    ]}
                  />
                </div>
              </div>
              <FunilChart pontos={grafico.pontos} formatar={grafico.formatar} inteiro={grafico.inteiro} />
              <p className="mt-1 text-[11px] text-slate-500">
                Clique numa etapa abaixo para trocar o gráfico. Cada dia conta os leads que entraram nele; os últimos dias ainda estão
                amadurecendo (qualificação e reunião chegam depois).
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
            {etapas(t).map((e, i) => (
              <CartaoEtapa key={e.rotulo} e={e} primeira={i === 0} marcado={e.metrica === metrica} onClick={() => setMetrica(e.metrica)} />
            ))}
          </div>

          <button
            type="button"
            onClick={alternarPorAnuncio}
            aria-expanded={porAnuncio}
            className="mt-4 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            <span className={"inline-block transition-transform " + (porAnuncio ? "rotate-90" : "")}>▸</span>
            {porAnuncio ? "Ocultar detalhe por anúncio" : `Ver detalhe por anúncio (${dados.anuncios.length})`}
          </button>

          {porAnuncio && (
            <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs tabular-nums">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="py-2 pr-3 text-left font-medium">Anúncio</th>
                  {colunas.map((c) => (
                    <th key={c.rotulo} className="px-2 text-right font-medium">
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dados.anuncios.map((a) => (
                  <tr key={a.anuncio} className="border-b border-white/5 text-slate-200">
                    <td className="max-w-[240px] py-2 pr-3">
                      <div className="truncate" title={a.anuncio}>
                        {a.anuncio}
                      </div>
                      {a.campanha && (
                        <div className="truncate text-[10px] text-slate-500" title={a.campanha}>
                          {a.campanha}
                        </div>
                      )}
                    </td>
                    {colunas.map((c) => (
                      <td key={c.rotulo} className={"px-2 text-right " + (c.chave ? "font-semibold text-brand" : "")}>
                        {c.valor(a)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="text-slate-100">
                  <td className="py-2 pr-3 font-semibold">Total</td>
                  {colunas.map((c) => (
                    <td key={c.rotulo} className={"px-2 text-right font-semibold " + (c.chave ? "text-brand" : "")}>
                      {c.valor(t)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Gasto, impressões e cliques vêm da Meta. Leads e o resto do funil vêm do CRM, pelo anúncio de origem de cada lead; a mesma pessoa com dois cards conta uma vez.
            {dados.sem_anuncio > 0 && ` ${dados.sem_anuncio} leads da Meta sem anúncio identificado entram só no total.`}
          </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
