"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateLeadTracking,
  type CampoRastreio,
} from "@/app/(app)/leads/actions";
import type { Lead } from "@/types/database";

// Um lead so devolve conversao para a plataforma se tiver o identificador
// do clique. Quando ele chega sem (repasse de automacao, conversa iniciada
// no WhatsApp), da para pegar o id na exportacao do formulario e cadastrar
// aqui - e a conversao que ficou parada sobe na hora.

type Campo = { campo: CampoRastreio; rotulo: string; ajuda: string };

const GOOGLE: Campo[] = [
  { campo: "gclid", rotulo: "gclid", ajuda: "Clique no Google (Android/desktop)" },
  { campo: "gbraid", rotulo: "gbraid", ajuda: "Clique no iOS vindo de app" },
  { campo: "wbraid", rotulo: "wbraid", ajuda: "Clique no iOS na web" },
];

const META: Campo[] = [
  { campo: "meta_lead_id", rotulo: "Meta lead ID", ajuda: "Formulário instantâneo" },
  { campo: "ctwa_clid", rotulo: "ctwa_clid", ajuda: "Anúncio Click-to-WhatsApp" },
];

function camposDe(lead: Lead): Campo[] {
  // A origem so define a ordem: um lead classificado como whatsapp pode ser
  // pago e receber o identificador na mao.
  if (lead.origem === "google_ads") return [...GOOGLE, ...META];
  if (lead.origem === "meta_ads") return [...META, ...GOOGLE];
  return [...META, ...GOOGLE];
}

function preenchidos(lead: Lead): Campo[] {
  return [...GOOGLE, ...META].filter((c) => lead[c.campo]);
}

export function TrackingCell({ lead }: { lead: Lead }) {
  const [aberto, setAberto] = useState(false);
  const temRastreio = preenchidos(lead).length > 0;

  const resumo = temRastreio
    ? preenchidos(lead)
        .map((c) => `${c.rotulo}: ${lead[c.campo]}`)
        .join("\n")
    : "Sem rastreamento — clique para cadastrar";

  return (
    <>
      <button
        type="button"
        title={resumo}
        onClick={() => setAberto(true)}
        aria-label={
          temRastreio ? "Editar rastreamento" : "Cadastrar rastreamento"
        }
        className={
          "text-base leading-none transition hover:scale-110 " +
          (temRastreio ? "" : "text-slate-600 hover:text-slate-400")
        }
      >
        {temRastreio ? "🔗" : "○"}
      </button>

      {aberto && (
        <Editor lead={lead} onFechar={() => setAberto(false)} />
      )}
    </>
  );
}

function Editor({ lead, onFechar }: { lead: Lead; onFechar: () => void }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<CampoRastreio | null>(null);

  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...GOOGLE, ...META].map((c) => [c.campo, lead[c.campo] ?? ""])
    )
  );

  function salvar(campo: CampoRastreio) {
    setErro(null);
    startTransition(async () => {
      const r = await updateLeadTracking(lead.id, campo, valores[campo] ?? "");
      if (r?.error) {
        setErro(r.error);
        return;
      }
      setSalvo(campo);
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}
    >
      <div
        className="sd-card w-full max-w-md p-5 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-white">Rastreamento</div>
            <div className="text-xs text-slate-400">{lead.nome}</div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="text-slate-400 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          Cadastrar o identificador destrava a conversão que ficou parada por
          falta dele — ela sobe para a plataforma assim que você salvar.
        </p>

        <div className="flex flex-col gap-3">
          {camposDe(lead).map((c) => (
            <div key={c.campo}>
              <label
                htmlFor={`rastreio-${c.campo}`}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="font-medium text-slate-200">{c.rotulo}</span>
                <span className="text-[11px] text-slate-500">{c.ajuda}</span>
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id={`rastreio-${c.campo}`}
                  value={valores[c.campo] ?? ""}
                  onChange={(e) => {
                    setSalvo(null);
                    setValores((v) => ({ ...v, [c.campo]: e.target.value }));
                  }}
                  placeholder="vazio"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white placeholder:text-slate-600 focus:border-brand focus:outline-none"
                />
                <button
                  type="button"
                  disabled={pendente || (lead[c.campo] ?? "") === (valores[c.campo] ?? "")}
                  onClick={() => salvar(c.campo)}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-navy hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {salvo === c.campo ? "Salvo" : "Salvar"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {erro && <div className="mt-3 text-xs text-red-400">{erro}</div>}
      </div>
    </div>
  );
}
