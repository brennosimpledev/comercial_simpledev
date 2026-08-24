"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLeadInfo } from "@/app/(app)/leads/actions";
import { ORIGIN_LABELS, type Lead } from "@/types/database";

const inputCls = "sd-input px-2 py-1.5";
const labelCls = "sd-label";

export function LeadInfoEditor({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    nome: lead.nome ?? "",
    whatsapp: lead.whatsapp ?? "",
    email: lead.email ?? "",
    origem: lead.origem,
    orcamento: lead.orcamento ?? "",
    valor_fechado:
      lead.valor_fechado != null ? String(lead.valor_fechado) : "",
    necessidade: lead.necessidade ?? "",
    prazo: lead.prazo ?? "",
  });

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  function save() {
    startTransition(async () => {
      const res = await updateLeadInfo(lead.id, form);
      if (res?.error) alert(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const criadoEm = new Date(lead.created_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Nome</label>
        <input
          value={form.nome}
          onChange={(e) => set("nome", e.target.value)}
          className={inputCls + " font-medium"}
        />
      </div>

      <div>
        <label className={labelCls}>Telefone</label>
        <input
          value={form.whatsapp}
          onChange={(e) => set("whatsapp", e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>E-mail</label>
        <input
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Meio de aquisição</label>
        <select
          value={form.origem}
          onChange={(e) => set("origem", e.target.value)}
          className={inputCls}
        >
          {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Data de criação</label>
        <p className="mt-0.5 text-sm text-slate-300">{criadoEm}</p>
      </div>

      <div>
        <label className={labelCls}>Orçamento</label>
        <input
          value={form.orcamento}
          onChange={(e) => set("orcamento", e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Valor fechado (R$)</label>
        <input
          value={form.valor_fechado}
          onChange={(e) => set("valor_fechado", e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Necessidade</label>
        <textarea
          value={form.necessidade}
          onChange={(e) => set("necessidade", e.target.value)}
          rows={2}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Prazo / início</label>
        <input
          value={form.prazo}
          onChange={(e) => set("prazo", e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy transition hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Salvando..." : "Salvar dados"}
        </button>
        {saved && <span className="text-xs text-emerald-600">Salvo ✓</span>}
      </div>
    </div>
  );
}
