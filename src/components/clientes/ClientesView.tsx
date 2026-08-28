"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ORIGIN_LABELS,
  STAGE_LABELS,
  type Lead,
  type LeadOrigin,
} from "@/types/database";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtMoeda(v: number) {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

// wa.me exige so digitos, com DDI.
function waLink(whatsapp: string) {
  const d = whatsapp.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("55") ? d : "55" + d}`;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex-1 rounded-xl bg-violet-600 px-4 py-3 text-center text-white">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs opacity-90">{label}</div>
    </div>
  );
}

export function ClientesView({ clientes }: { clientes: Lead[] }) {
  const [busca, setBusca] = useState("");

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q
      ? clientes.filter(
          (c) =>
            c.nome.toLowerCase().includes(q) ||
            (c.email ?? "").toLowerCase().includes(q) ||
            (c.whatsapp ?? "").includes(q)
        )
      : clientes;
    return [...base].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [clientes, busca]);

  // Soma so o que tem valor preenchido; cliente sem contrato registrado nao
  // deve puxar a media para baixo silenciosamente.
  const comValor = clientes.filter((c) => (c.valor_fechado ?? 0) > 0);
  const total = comValor.reduce((s, c) => s + (c.valor_fechado ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Clientes</h1>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, email ou telefone"
          className="sd-input w-72"
        />
      </div>

      <div className="mb-4 flex gap-2">
        <Kpi label="Clientes" value={clientes.length} />
        <Kpi label="Com valor registrado" value={comValor.length} />
        <Kpi label="Total contratado" value={fmtMoeda(total)} />
      </div>

      {clientes.length === 0 ? (
        <div className="sd-card p-8 text-center">
          <p className="text-sm text-slate-400">
            Nenhum cliente marcado ainda.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Marque um lead como &ldquo;Já é cliente&rdquo; no painel dele e ele
            aparece aqui, fora das métricas do funil.
          </p>
        </div>
      ) : (
        <div className="sd-card overflow-hidden">
          {lista.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 border-b border-white/5 px-4 py-3 text-sm last:border-b-0 hover:bg-white/5"
            >
              <div className="w-52 shrink-0 font-medium text-white">
                <Link href={`/leads/${c.id}`} className="hover:text-brand">
                  {c.nome}
                </Link>
              </div>

              <div className="w-40 shrink-0">
                {c.whatsapp ? (
                  <a
                    href={waLink(c.whatsapp)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    {c.whatsapp}
                  </a>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </div>

              <div className="hidden flex-1 truncate text-slate-400 md:block">
                {c.email ?? ""}
              </div>

              <div className="w-28 shrink-0 text-right text-slate-300">
                {(c.valor_fechado ?? 0) > 0 ? (
                  fmtMoeda(c.valor_fechado!)
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </div>

              <div className="w-28 shrink-0 text-xs text-slate-400">
                {STAGE_LABELS[c.estagio]}
              </div>

              <div className="w-24 shrink-0 text-xs text-slate-500">
                {ORIGIN_LABELS[c.origem as LeadOrigin] ?? c.origem}
              </div>

              <div className="w-16 shrink-0 text-right text-xs text-slate-500">
                {fmtDate(c.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Clientes ficam fora dos KPIs de Leads e não são enviados como conversão
        para o Google Ads e a Meta. Para tirar alguém daqui, abra o cadastro e
        desligue &ldquo;Já é cliente&rdquo;.
      </p>
    </div>
  );
}
