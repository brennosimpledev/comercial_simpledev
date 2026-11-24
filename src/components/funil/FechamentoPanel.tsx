"use client";

import { useEffect, useState } from "react";
import {
  salvarValorFechado,
  statusConversoes,
  type EnvioConversao,
} from "@/app/(app)/leads/conversoes";
import { adicionarUpsell, removerUpsell } from "@/app/(app)/leads/upsells";
import type { LeadUpsell } from "@/types/database";

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
  upsells,
  aoSalvar,
  aoAdicionarUpsell,
  aoRemoverUpsell,
}: {
  leadId: string;
  valor: number | null;
  jaCliente: boolean;
  upsells: LeadUpsell[];
  aoSalvar: (valor: number) => void;
  aoAdicionarUpsell: (u: LeadUpsell) => void;
  aoRemoverUpsell: (id: string) => void;
}) {
  const [texto, setTexto] = useState(valor ? String(valor) : "");
  const [salvando, setSalvando] = useState(false);
  const [envios, setEnvios] = useState<EnvioConversao[] | null>(null);
  const [abrindoUpsell, setAbrindoUpsell] = useState(false);
  const [upsellValor, setUpsellValor] = useState("");
  const [upsellDesc, setUpsellDesc] = useState("");
  const [salvandoUpsell, setSalvandoUpsell] = useState(false);

  function carregar() {
    statusConversoes(leadId).then((r) => setEnvios(r.envios ?? []));
  }

  useEffect(() => {
    setTexto(valor ? String(valor) : "");
    setEnvios(null);
    setAbrindoUpsell(false);
    setUpsellValor("");
    setUpsellDesc("");
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function salvarUpsell() {
    setSalvandoUpsell(true);
    const r = await adicionarUpsell(leadId, upsellValor, upsellDesc);
    setSalvandoUpsell(false);
    if (r.error) return alert(r.error);
    aoAdicionarUpsell(r.upsell!);
    setUpsellValor("");
    setUpsellDesc("");
    setAbrindoUpsell(false);
  }

  async function excluirUpsell(u: LeadUpsell) {
    if (!confirm(`Remover o upsell de ${moeda(u.valor)}?`)) return;
    const r = await removerUpsell(u.id);
    if (r.error) return alert(r.error);
    aoRemoverUpsell(u.id);
  }

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
  const totalUpsells = upsells.reduce((s, u) => s + u.valor, 0);

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

      <div className="mt-4 border-t border-white/10 pt-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="sd-label !mb-0">Upsells</p>
          {totalUpsells > 0 && (
            <span className="text-xs font-semibold text-emerald-400">
              +{moeda(totalUpsells)}
            </span>
          )}
        </div>

        {upsells.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1.5">
            {upsells.map((u) => (
              <li key={u.id} className="flex items-start gap-2 text-xs">
                <span className="w-20 shrink-0 font-semibold text-emerald-400">
                  {moeda(u.valor)}
                </span>
                <span className="min-w-0 flex-1 text-slate-300">
                  {u.descricao || <span className="text-slate-500">sem descrição</span>}
                  <span className="ml-1.5 text-slate-500">
                    {new Date(u.data + "T12:00:00").toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                    })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => excluirUpsell(u)}
                  title="Remover upsell"
                  className="shrink-0 text-slate-500 hover:text-red-400"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {abrindoUpsell ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={upsellValor}
                onChange={(e) => setUpsellValor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && upsellValor.trim() && salvarUpsell()}
                placeholder="12.000 ou 12 mil"
                className="sd-input w-32 px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={upsellDesc}
                onChange={(e) => setUpsellDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && upsellValor.trim() && salvarUpsell()}
                placeholder="O que foi vendido (opcional)"
                className="sd-input flex-1 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={salvarUpsell}
                disabled={salvandoUpsell || !upsellValor.trim()}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-50"
              >
                {salvandoUpsell ? "Salvando…" : "Salvar upsell"}
              </button>
              <button
                type="button"
                onClick={() => setAbrindoUpsell(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAbrindoUpsell(true)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-brand/40 hover:text-white"
          >
            + Adicionar upsell
          </button>
        )}

        {(valor || totalUpsells > 0) && (
          <p className="mt-2 text-xs text-slate-400">
            Total do cliente:{" "}
            <span className="font-semibold text-slate-200">
              {moeda((valor ?? 0) + totalUpsells)}
            </span>
          </p>
        )}
      </div>

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
