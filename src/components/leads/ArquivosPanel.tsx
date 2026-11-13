"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listarArquivos,
  uploadArquivo,
  marcarAtual,
  removerArquivo,
  type ArquivoComLink,
} from "@/app/(app)/leads/arquivos";
import type { ArquivoTipo } from "@/types/database";
import { DropZone } from "@/components/ui/DropZone";
import { enviarArquivoCloser } from "@/app/(app)/funil/closer";
import { textoDoDocumento } from "@/components/funil/mensagensProntas";

const ABAS: { tipo: ArquivoTipo; label: string }[] = [
  { tipo: "escopo", label: "Escopos" },
  { tipo: "proposta", label: "Propostas" },
];

const LIMITE_MB = 4.5;

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtValor(v: number | null) {
  if (v === null) return null;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// whatsapp: so no Funil. Liga o envio do documento pelo WhatsApp do closer.
export function ArquivosPanel({
  leadId,
  whatsapp,
}: {
  leadId: string;
  whatsapp?: { nome: string; temNumero: boolean };
}) {
  const router = useRouter();
  const [aba, setAba] = useState<ArquivoTipo>("escopo");
  const [arquivos, setArquivos] = useState<ArquivoComLink[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [valor, setValor] = useState("");
  const [compor, setCompor] = useState<{ id: string; nome: string } | null>(null);
  const [textoEnvio, setTextoEnvio] = useState("");
  const [mandando, setMandando] = useState(false);
  const [retorno, setRetorno] = useState<{ ok: boolean; texto: string } | null>(null);

  function abrirEnvio(a: { id: string; nome: string; tipo: ArquivoTipo }) {
    if (!whatsapp?.temNumero) return;
    setRetorno(null);
    setCompor({ id: a.id, nome: a.nome });
    setTextoEnvio(textoDoDocumento(a.tipo === "proposta" ? "proposta" : "escopo", whatsapp.nome));
  }

  async function mandarNoWhatsApp() {
    if (!compor) return;
    setMandando(true);
    const r = await enviarArquivoCloser(leadId, compor.id, textoEnvio);
    setMandando(false);
    if ("error" in r && r.error) return setRetorno({ ok: false, texto: r.error });
    setCompor(null);
    setRetorno({ ok: true, texto: "Enviado pelo seu WhatsApp ✓" });
  }

  async function recarregar() {
    const r = await listarArquivos(leadId);
    setArquivos(r.arquivos);
    return r.arquivos;
  }

  useEffect(() => {
    listarArquivos(leadId).then((r) => setArquivos(r.arquivos));
  }, [leadId]);

  async function enviar(arquivos: File[]) {
    const file = arquivos[0];
    if (!file) return;
    if (file.size > LIMITE_MB * 1024 * 1024) {
      alert(`${file.name} passa de ${LIMITE_MB}MB.`);
      return;
    }
    setEnviando(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tipo", aba);
    if (aba === "proposta" && valor.trim()) fd.append("valor", valor.trim());
    const res = await uploadArquivo(leadId, fd);
    setEnviando(false);
    if (res?.error) {
      alert(res.error);
      return;
    }
    setValor("");
    const lista = await recarregar();
    router.refresh();
    // Acabou de salvar: ja oferece mandar para o cliente.
    const novo = lista.find((a) => a.tipo === aba && a.atual);
    if (novo) abrirEnvio(novo);
  }

  async function tornarAtual(id: string) {
    const res = await marcarAtual(id);
    if (res?.error) return alert(res.error);
    await recarregar();
  }

  async function remover(a: ArquivoComLink) {
    if (!confirm(`Remover ${a.nome} (v${a.versao})?`)) return;
    const res = await removerArquivo(a.id);
    if (res?.error) return alert(res.error);
    await recarregar();
  }

  const daAba = (arquivos ?? []).filter((a) => a.tipo === aba);
  const atual = daAba.find((a) => a.atual) ?? null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Documentos</h2>
        <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
          {ABAS.map((t) => (
            <button
              key={t.tipo}
              type="button"
              onClick={() => setAba(t.tipo)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                aba === t.tipo
                  ? "bg-brand/15 text-brand"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {atual && (
        <div className="mb-3 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-brand">
            {aba === "escopo" ? "Escopo atual" : "Proposta atual"} · v{atual.versao}
          </p>
          <div className="mt-1 flex items-center gap-3">
            {atual.url ? (
              <a
                href={atual.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-sm text-slate-100 hover:underline"
                title={atual.nome}
              >
                {atual.nome}
              </a>
            ) : (
              <span className="flex-1 truncate text-sm text-slate-400">{atual.nome}</span>
            )}
            {fmtValor(atual.valor) && (
              <span className="shrink-0 text-sm font-semibold text-emerald-400">
                {fmtValor(atual.valor)}
              </span>
            )}
          </div>
          {whatsapp && compor?.id !== atual.id && (
            <button
              type="button"
              onClick={() => abrirEnvio(atual)}
              disabled={!whatsapp.temNumero}
              title={whatsapp.temNumero ? "Manda o arquivo e uma mensagem pelo seu WhatsApp" : "Lead sem WhatsApp cadastrado"}
              className="mt-2 rounded-lg border border-sky-500/40 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
            >
              Enviar no WhatsApp
            </button>
          )}
        </div>
      )}

      {compor && (
        <div className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-200">
            Enviar no seu WhatsApp
          </p>
          <p className="mb-2 truncate text-xs text-slate-300" title={compor.nome}>
            📎 {compor.nome}
          </p>
          <textarea
            value={textoEnvio}
            onChange={(e) => setTextoEnvio(e.target.value)}
            rows={4}
            className="mb-2 w-full rounded-lg border border-white/10 bg-[#0b2a49] px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={mandarNoWhatsApp}
              disabled={mandando}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {mandando ? "Enviando…" : "Enviar arquivo e mensagem"}
            </button>
            <button
              type="button"
              onClick={() => setCompor(null)}
              disabled={mandando}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      {retorno && (
        <p className={"mb-3 text-xs " + (retorno.ok ? "text-emerald-300" : "text-red-300")}>{retorno.texto}</p>
      )}

      {arquivos === null ? (
        <p className="text-xs text-slate-500">Carregando...</p>
      ) : daAba.length === 0 ? (
        <p className="mb-3 text-xs text-slate-500">
          Nenhum {aba === "escopo" ? "escopo" : "proposta"} enviado ainda.
        </p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {daAba.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-white/5 bg-navy px-3 py-2"
            >
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  a.atual ? "bg-brand/20 text-brand" : "bg-white/5 text-slate-500"
                }`}
              >
                v{a.versao}
              </span>
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-sm text-slate-200 hover:text-brand hover:underline"
                  title={a.nome}
                >
                  {a.nome}
                </a>
              ) : (
                <span className="flex-1 truncate text-sm text-slate-400">{a.nome}</span>
              )}
              <span className="shrink-0 text-[11px] text-slate-500">
                {fmtData(a.created_at)}
              </span>
              {fmtValor(a.valor) && (
                <span className="shrink-0 text-[11px] text-emerald-400">
                  {fmtValor(a.valor)}
                </span>
              )}
              {!a.atual && (
                <button
                  type="button"
                  onClick={() => tornarAtual(a.id)}
                  className="shrink-0 text-[11px] text-slate-400 hover:text-brand"
                >
                  Tornar atual
                </button>
              )}
              <button
                type="button"
                onClick={() => remover(a)}
                className="shrink-0 text-[11px] text-red-400 hover:text-red-300"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      {aba === "proposta" && (
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Valor da proposta (opcional) — ex: 28.000,00"
          className="sd-input mb-2 px-2 py-1.5 text-sm"
          inputMode="decimal"
        />
      )}

      <DropZone
        onFiles={enviar}
        enviando={enviando}
        label={`+ Arraste ou clique para enviar ${
          aba === "escopo" ? "o escopo" : "a proposta"
        } (vira a versão atual)`}
      />
    </div>
  );
}
