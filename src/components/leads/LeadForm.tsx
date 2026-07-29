"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createManualLead } from "@/app/(app)/leads/actions";
import { ORIGIN_LABELS, STAGE_LABELS } from "@/types/database";

const initialState: { error?: string } = {};

const inputClass = "sd-input";
const labelClass = "sd-label";

export function LeadForm() {
  const [state, formAction, pending] = useActionState(
    createManualLead,
    initialState
  );

  return (
    <form
      action={formAction}
      className="sd-card space-y-4 p-6"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="nome" className={labelClass}>
            Nome *
          </label>
          <input id="nome" name="nome" required className={inputClass} />
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            E-mail
          </label>
          <input id="email" name="email" type="email" className={inputClass} />
        </div>

        <div>
          <label htmlFor="whatsapp" className={labelClass}>
            WhatsApp
          </label>
          <input id="whatsapp" name="whatsapp" className={inputClass} />
        </div>

        <div>
          <label htmlFor="origem" className={labelClass}>
            Origem
          </label>
          <select
            id="origem"
            name="origem"
            defaultValue="indicacao"
            className={inputClass}
          >
            {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="estagio" className={labelClass}>
            Estágio
          </label>
          <select
            id="estagio"
            name="estagio"
            defaultValue="novo"
            className={inputClass}
          >
            {Object.entries(STAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="orcamento" className={labelClass}>
            Orçamento
          </label>
          <input id="orcamento" name="orcamento" className={inputClass} />
        </div>

        <div>
          <label htmlFor="prazo" className={labelClass}>
            Prazo / início
          </label>
          <input id="prazo" name="prazo" className={inputClass} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="necessidade" className={labelClass}>
            Necessidade
          </label>
          <textarea
            id="necessidade"
            name="necessidade"
            rows={2}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="anotacoes" className={labelClass}>
            Anotações
          </label>
          <textarea
            id="anotacoes"
            name="anotacoes"
            rows={3}
            className={inputClass}
          />
        </div>
      </div>

      {state?.error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="sd-btn">
          {pending ? "Salvando..." : "Salvar lead"}
        </button>
        <Link href="/leads" className="text-sm text-slate-400 hover:text-brand">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
