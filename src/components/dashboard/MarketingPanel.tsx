"use client";

import { useEffect, useState } from "react";
import { metricasMarketing, type Funil, type Marketing } from "@/app/(app)/leads/marketing";

// Funil do periodo, passo a passo: do dinheiro investido na Meta ate o
// contrato fechado. Cada etapa mostra quantos chegaram ali, quanto custou
// cada um e quantos passaram da etapa anterior.

const brl = (v: number, casas = 0) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (v: number) => v.toLocaleString("pt-BR");
const custo = (gasto: number, n: number, casas = 0) => (n > 0 && gasto > 0 ? brl(gasto / n, casas) : "—");
const taxa = (a: number, b: number, casas = 0) =>
  b > 0 ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%` : "—";

type Etapa = {
  rotulo: string;
  valor: string;
  custo?: { rotulo: string; valor: string; chave?: boolean };
  passagem?: string;
};

function etapas(f: Funil): Etapa[] {
  return [
    { rotulo: "Investimento", valor: brl(f.gasto) },
    {
      rotulo: "Impressões",
      valor: num(f.impressoes),
      custo: { rotulo: "CPM", valor: custo(f.gasto * 1000, f.impressoes, 2) },
    },
    {
      rotulo: "Cliques no link",
      valor: num(f.cliques),
      custo: { rotulo: "CPC", valor: custo(f.gasto, f.cliques, 2) },
      passagem: `CTR ${taxa(f.cliques, f.impressoes, 2)}`,
    },
    {
      rotulo: "Leads",
      valor: num(f.pessoas),
      custo: { rotulo: "por lead", valor: custo(f.gasto, f.pessoas, 2), chave: true },
      passagem: `${taxa(f.pessoas, f.cliques, 1)} dos cliques`,
    },
    {
      rotulo: "Conversaram",
      valor: num(f.conversaram),
      custo: { rotulo: "por conversa", valor: custo(f.gasto, f.conversaram) },
      passagem: `${taxa(f.conversaram, f.pessoas)} dos leads`,
    },
    {
      rotulo: "Qualificados",
      valor: num(f.qualificados),
      custo: { rotulo: "por qualificado", valor: custo(f.gasto, f.qualificados), chave: true },
      passagem: `${taxa(f.qualificados, f.conversaram)} de quem conversou`,
    },
    {
      rotulo: "Reuniões",
      valor: num(f.reunioes),
      custo: { rotulo: "por reunião", valor: custo(f.gasto, f.reunioes), chave: true },
      passagem: `${taxa(f.reunioes, f.pessoas)} dos leads`,
    },
    {
      rotulo: "Realizadas",
      valor: num(f.realizadas),
      custo: { rotulo: "por realizada", valor: custo(f.gasto, f.realizadas) },
      passagem: `${taxa(f.realizadas, f.reunioes)} das marcadas`,
    },
    {
      rotulo: "Fechados",
      valor: num(f.fechados),
      custo: { rotulo: "por venda", valor: custo(f.gasto, f.fechados), chave: true },
      passagem: f.valor_fechado > 0 ? `${brl(f.valor_fechado)} · ${(f.valor_fechado / Math.max(f.gasto, 1)).toFixed(1)}x` : `${taxa(f.fechados, f.realizadas)} das realizadas`,
    },
  ];
}

function CartaoEtapa({ e, primeira }: { e: Etapa; primeira: boolean }) {
  return (
    <div className="relative flex min-w-0 flex-col rounded-xl border border-white/10 bg-navy-mid px-3 py-2.5">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
            {etapas(t).map((e, i) => (
              <CartaoEtapa key={e.rotulo} e={e} primeira={i === 0} />
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
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
        </div>
      )}
    </section>
  );
}
