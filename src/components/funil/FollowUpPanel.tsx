"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listarContatos,
  registrarContato,
  adiarRetorno,
  limparRetorno,
} from "@/app/(app)/leads/contatos";
import type { LeadContato } from "@/types/database";

const CANAIS = [
  { valor: "whatsapp", label: "WhatsApp" },
  { valor: "ligacao", label: "Ligação" },
  { valor: "email", label: "E-mail" },
  { valor: "reuniao", label: "Reunião" },
];

const ATALHOS = [3, 7, 15, 30];

function emDias(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function fmtData(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

function fmtQuando(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function FollowUpPanel({
  leadId,
  proximoContato,
  aoMudar,
}: {
  leadId: string;
  proximoContato: string | null;
  aoMudar?: (proximo: string | null) => void;
}) {
  const router = useRouter();
  const [contatos, setContatos] = useState<LeadContato[] | null>(null);
  const [resumo, setResumo] = useState("");
  const [canal, setCanal] = useState("whatsapp");
  const [proximo, setProximo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setContatos(null);
    setResumo("");
    setProximo("");
    listarContatos(leadId).then((r) => setContatos(r.contatos));
  }, [leadId]);

  async function salvar() {
    setSalvando(true);
    const res = await registrarContato(leadId, {
      resumo,
      canal,
      proximoEm: proximo || null,
    });
    setSalvando(false);
    if (res?.error) return alert(res.error);
    setResumo("");
    setProximo("");
    aoMudar?.(proximo || null);
    const r = await listarContatos(leadId);
    setContatos(r.contatos);
    router.refresh();
  }

  async function adiar(dias: number) {
    const res = await adiarRetorno(leadId, dias);
    if (res?.error) return alert(res.error);
    aoMudar?.(res.proximo ?? null);
    const r = await listarContatos(leadId);
    setContatos(r.contatos);
    router.refresh();
  }

  async function limpar() {
    const res = await limparRetorno(leadId);
    if (res?.error) return alert(res.error);
    aoMudar?.(null);
    const r = await listarContatos(leadId);
    setContatos(r.contatos);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Follow-up</h3>
        {proximoContato && (
          <span className="flex items-center gap-2 text-xs text-slate-400">
            retorno {fmtData(proximoContato)}
            <button
              type="button"
              onClick={limpar}
              className="text-slate-500 hover:text-red-400"
              title="Tirar o retorno da agenda"
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {proximoContato && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Adiar:</span>
          {ATALHOS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => adiar(d)}
              className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:border-brand/40 hover:text-brand"
            >
              +{d}d
            </button>
          ))}
        </div>
      )}

      <textarea
        value={resumo}
        onChange={(e) => setResumo(e.target.value)}
        rows={3}
        placeholder="O que o cliente disse? Ex: está resolvendo o financeiro, pediu para voltar em 15 dias."
        className="sd-input mb-2 px-2 py-1.5 text-sm"
      />

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {CANAIS.map((c) => (
          <button
            key={c.valor}
            type="button"
            onClick={() => setCanal(c.valor)}
            className={
              "rounded-md px-2 py-0.5 text-[11px] transition " +
              (canal === c.valor
                ? "bg-brand/15 text-brand"
                : "text-slate-500 hover:text-slate-300")
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500">Voltar em:</span>
        {ATALHOS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setProximo(emDias(d))}
            className={
              "rounded border px-2 py-0.5 text-[11px] transition " +
              (proximo === emDias(d)
                ? "border-brand bg-brand/15 text-brand"
                : "border-white/10 text-slate-300 hover:border-brand/40")
            }
          >
            +{d}d
          </button>
        ))}
        <input
          type="date"
          value={proximo}
          onChange={(e) => setProximo(e.target.value)}
          className="rounded border border-white/10 bg-navy px-2 py-0.5 text-[11px] text-slate-200"
        />
      </div>

      <button
        type="button"
        onClick={salvar}
        disabled={salvando}
        className="sd-btn mb-4 w-full py-1.5 text-sm"
      >
        {salvando ? "Salvando..." : "Registrar follow-up"}
      </button>

      {contatos === null ? (
        <p className="text-xs text-slate-500">Carregando...</p>
      ) : contatos.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum follow-up registrado.</p>
      ) : (
        <ul className="space-y-2">
          {contatos.map((c) => (
            <li key={c.id} className="rounded-lg border border-white/5 bg-navy-mid p-2.5">
              <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{fmtQuando(c.feito_em)}</span>
                <span className="rounded bg-white/5 px-1.5 py-0.5">
                  {CANAIS.find((x) => x.valor === c.canal)?.label ?? c.canal}
                </span>
                {c.proximo_em && (
                  <span className={c.concluido ? "text-slate-600" : "text-brand"}>
                    retorno {fmtData(c.proximo_em)}
                  </span>
                )}
              </div>
              {c.resumo && (
                <p className="whitespace-pre-wrap text-sm text-slate-300">{c.resumo}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
