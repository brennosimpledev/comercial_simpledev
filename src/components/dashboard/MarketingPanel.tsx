"use client";

import { useEffect, useState } from "react";
import { metricasMarketing, type Funil, type Marketing } from "@/app/(app)/leads/marketing";

const brl = (v: number, casas = 0) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (v: number) => v.toLocaleString("pt-BR");
const razao = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

function derivados(f: Funil) {
  return {
    cpm: razao(f.gasto * 1000, f.impressoes),
    cpc: razao(f.gasto, f.cliques),
    ctr: f.impressoes > 0 ? (f.cliques / f.impressoes) * 100 : null,
    // CPL pelo que chegou no CRM (gente de verdade, sem card duplicado).
    cpl: razao(f.gasto, f.pessoas),
    cpq: razao(f.gasto, f.qualificados),
    cpr: razao(f.gasto, f.reunioes),
  };
}

function Bloco({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div
      className={
        "rounded-xl px-3 py-2.5 " +
        (destaque ? "bg-brand text-white" : "border border-white/10 bg-navy-mid text-slate-100")
      }
    >
      <div className="text-[11px] uppercase tracking-wide opacity-80">{rotulo}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{valor}</div>
      {detalhe && <div className="text-[11px] opacity-75">{detalhe}</div>}
    </div>
  );
}

export function MarketingPanel({ de, ate }: { de: string; ate: string }) {
  const [dados, setDados] = useState<Marketing | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [abrirTabela, setAbrirTabela] = useState(false);

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
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [de, ate]);

  const t = dados?.total;
  const d = t ? derivados(t) : null;
  const fmt = (v: number | null, casas = 2) => (v === null ? "—" : brl(v, casas));

  return (
    <section className="sd-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-300">Marketing (Meta Ads)</h2>
        {carregando && <span className="text-xs text-slate-500">Atualizando…</span>}
      </div>

      {erro && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{erro}</p>}

      {t && d && (
        <div className={carregando ? "opacity-60" : ""}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Bloco rotulo="Investimento" valor={brl(t.gasto)} detalhe={`${num(t.impressoes)} impressões`} />
            <Bloco rotulo="CPM" valor={fmt(d.cpm)} />
            <Bloco rotulo="CPC (link)" valor={fmt(d.cpc)} detalhe={`${num(t.cliques)} cliques`} />
            <Bloco rotulo="CTR (link)" valor={d.ctr === null ? "—" : `${d.ctr.toFixed(2)}%`} />
            <Bloco rotulo="Leads na Meta" valor={num(t.leads_meta)} detalhe="o que o Gerenciador conta" />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Bloco rotulo="Leads no CRM" valor={num(t.pessoas)} detalhe={`CPL ${fmt(d.cpl)}`} destaque />
            <Bloco
              rotulo="Qualificados"
              valor={num(t.qualificados)}
              detalhe={`${pct(t.qualificados, t.pessoas)} · ${fmt(d.cpq, 0)} cada`}
              destaque
            />
            <Bloco
              rotulo="Reuniões"
              valor={num(t.reunioes)}
              detalhe={`${pct(t.reunioes, t.pessoas)} · ${fmt(d.cpr, 0)} cada`}
              destaque
            />
            <Bloco rotulo="Realizadas" valor={num(t.realizadas)} detalhe={`${pct(t.realizadas, t.reunioes)} das marcadas`} destaque />
            <Bloco
              rotulo="Fechados"
              valor={num(t.fechados)}
              detalhe={t.valor_fechado > 0 ? `${brl(t.valor_fechado)} · ${(t.valor_fechado / Math.max(t.gasto, 1)).toFixed(1)}x o investido` : undefined}
              destaque
            />
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Leads que entraram no período. Desqualificados: {num(t.desqualificados)} ({pct(t.desqualificados, t.pessoas)}).
            {dados.sem_anuncio > 0 && ` ${dados.sem_anuncio} da Meta sem anúncio identificado.`} A mesma pessoa com dois cards conta uma vez.
          </p>

          <button
            type="button"
            onClick={() => setAbrirTabela((v) => !v)}
            className="mt-3 text-xs text-brand hover:underline"
          >
            {abrirTabela ? "Esconder" : "Ver"} por anúncio ({dados.anuncios.length})
          </button>

          {abrirTabela && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[980px] text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-white/10 text-left text-slate-400">
                    <th className="py-2 pr-3 font-medium">Anúncio</th>
                    <th className="px-2 text-right font-medium">Gasto</th>
                    <th className="px-2 text-right font-medium">CPM</th>
                    <th className="px-2 text-right font-medium">CPC</th>
                    <th className="px-2 text-right font-medium">CTR</th>
                    <th className="px-2 text-right font-medium">Leads</th>
                    <th className="px-2 text-right font-medium">CPL</th>
                    <th className="px-2 text-right font-medium">Qualif.</th>
                    <th className="px-2 text-right font-medium">R$/qualif.</th>
                    <th className="px-2 text-right font-medium">Desqualif.</th>
                    <th className="px-2 text-right font-medium">Reuniões</th>
                    <th className="px-2 text-right font-medium">R$/reunião</th>
                    <th className="pl-2 text-right font-medium">Fechados</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.anuncios.map((a) => {
                    const x = derivados(a);
                    return (
                      <tr key={a.anuncio} className="border-b border-white/5 text-slate-200">
                        <td className="max-w-[260px] py-2 pr-3">
                          <div className="truncate" title={a.anuncio}>{a.anuncio}</div>
                          {a.campanha && <div className="truncate text-[10px] text-slate-500" title={a.campanha}>{a.campanha}</div>}
                        </td>
                        <td className="px-2 text-right">{brl(a.gasto)}</td>
                        <td className="px-2 text-right">{fmt(x.cpm)}</td>
                        <td className="px-2 text-right">{fmt(x.cpc)}</td>
                        <td className="px-2 text-right">{x.ctr === null ? "—" : `${x.ctr.toFixed(2)}%`}</td>
                        <td className="px-2 text-right">{a.pessoas}</td>
                        <td className="px-2 text-right">{fmt(x.cpl)}</td>
                        <td className="px-2 text-right">{a.qualificados}</td>
                        <td className="px-2 text-right">{fmt(x.cpq, 0)}</td>
                        <td className="px-2 text-right text-slate-400">{a.desqualificados}</td>
                        <td className="px-2 text-right">{a.reunioes}</td>
                        <td className="px-2 text-right">{fmt(x.cpr, 0)}</td>
                        <td className="pl-2 text-right">{a.fechados > 0 ? `${a.fechados} · ${brl(a.valor_fechado)}` : "0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">
                Leads, qualificados, reuniões e fechados vêm do CRM, pelo anúncio de origem de cada lead. Gasto, CPM, CPC e CTR vêm da Meta.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
