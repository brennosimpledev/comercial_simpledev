"use client";

import { useEffect, useState } from "react";
import {
  salvarValorFechado,
  statusConversoes,
  type EnvioConversao,
} from "@/app/(app)/leads/conversoes";

// Valor do contrato e o que ja foi avisado para Meta e Google. O valor e o
// que ensina as plataformas a buscar quem fecha, nao so quem preenche.

const CANAL: Record<string, string> = { meta: "Meta", google: "Google Ads" };

const STATUS: Record<string, { texto: string; cls: string }> = {
  enviado: { texto: "Enviado", cls: "bg-emerald-500/15 text-emerald-300" },
  aguardando_valor: { texto: "Esperando o valor", cls: "bg-amber-500/15 text-amber-300" },
  pendente: { texto: "Enviando…", cls: "bg-white/5 text-slate-300" },
  erro: { texto: "Erro no envio", cls: "bg-red-500/15 text-red-300" },
  sem_lead_id: { texto: "Não veio de anúncio da Meta", cls: "bg-white/5 text-slate-400" },
  sem_gclid: { texto: "Não veio de anúncio do Google", cls: "bg-white/5 text-slate-400" },
};

function moeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function FechamentoPanel({
  leadId,
  valor,
  jaCliente,
  aoSalvar,
}: {
  leadId: string;
  valor: number | null;
  jaCliente: boolean;
  aoSalvar: (valor: number) => void;
}) {
  const [texto, setTexto] = useState(valor ? String(valor) : "");
  const [salvando, setSalvando] = useState(false);
  const [envios, setEnvios] = useState<EnvioConversao[] | null>(null);

  function carregar() {
    statusConversoes(leadId).then((r) => setEnvios(r.envios ?? []));
  }

  useEffect(() => {
    setTexto(valor ? String(valor) : "");
    setEnvios(null);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function salvar() {
    setSalvando(true);
    const r = await salvarValorFechado(leadId, texto);
    setSalvando(false);
    if (r.error) return alert(r.error);
    aoSalvar(r.valor!);
    setTexto(String(r.valor));
    // O envio roda depois da resposta: da um tempo antes de reler.
    setTimeout(carregar, 4000);
  }

  const fechamentos = (envios ?? []).filter((e) => e.tipo === "fechado");

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-200">Fechamento</h3>
      <label className="sd-label">Valor do contrato</label>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && salvar()}
          placeholder="50.000 ou 50 mil"
          className="sd-input flex-1 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !texto.trim()}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {valor ? <p className="mt-1 text-xs text-slate-400">Registrado: {moeda(valor)}</p> : null}

      <p className="sd-label mt-3">Retorno para os anúncios</p>
      {jaCliente ? (
        <p className="text-xs text-slate-400">
          Marcado como cliente que já existia: não conta como venda de anúncio e não é enviado.
        </p>
      ) : envios === null ? (
        <p className="text-xs text-slate-500">Carregando…</p>
      ) : fechamentos.length === 0 ? (
        <p className="text-xs text-slate-400">
          Nada enviado ainda. Salve o valor para registrar e enviar o fechamento.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {fechamentos.map((e) => {
            const s = STATUS[e.status] ?? { texto: e.status, cls: "bg-white/5 text-slate-300" };
            return (
              <li key={e.canal} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-slate-300">{CANAL[e.canal] ?? e.canal}</span>
                <span className={`rounded px-1.5 py-0.5 ${s.cls}`} title={e.erro ?? undefined}>
                  {s.texto}
                </span>
                {e.status === "enviado" && (
                  <span className="text-slate-500">
                    {e.valor ? moeda(e.valor) : ""}
                    {e.enviado_em
                      ? ` · ${new Date(e.enviado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                      : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
