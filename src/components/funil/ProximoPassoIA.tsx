"use client";

import { useEffect, useState } from "react";
import { proximoPasso, ultimaAnalise } from "@/app/(app)/funil/ia";
import { registrarContato } from "@/app/(app)/leads/contatos";
import type { ProximoPasso } from "@/lib/ia/proximoPasso";

const CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
};

function dia(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function ProximoPassoIA({
  leadId,
  proximoContato,
  aoSalvarFollowup,
  aoUsarMensagem,
}: {
  leadId: string;
  proximoContato: string | null;
  aoSalvarFollowup: (data: string) => void;
  aoUsarMensagem: (texto: string) => void;
}) {
  const [sugestao, setSugestao] = useState<ProximoPasso | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [lendoSalvo, setLendoSalvo] = useState(true);
  const [novidade, setNovidade] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar(forcar: boolean) {
    setCarregando(true);
    setErro(null);
    const r = await proximoPasso(leadId, forcar);
    setCarregando(false);
    if (r.error) setErro(r.error);
    if (r.sugestao) {
      setSugestao(r.sugestao);
      setGeradoEm(r.gerado_em ?? null);
      setNovidade(false);
    }
  }

  // Abrir o card nao chama a IA: so mostra a ultima analise guardada.
  useEffect(() => {
    let vivo = true;
    setSugestao(null);
    setLendoSalvo(true);
    setNovidade(false);
    setErro(null);
    ultimaAnalise(leadId).then((r) => {
      if (!vivo) return;
      setLendoSalvo(false);
      if ("error" in r && r.error) return setErro(r.error);
      if ("sugestao" in r && r.sugestao) {
        setSugestao(r.sugestao);
        setGeradoEm(r.gerado_em ?? null);
        setNovidade(Boolean(r.novidade));
      }
    });
    return () => {
      vivo = false;
    };
  }, [leadId]);

  async function salvarFollowup() {
    const f = sugestao?.followup;
    if (!f) return;
    setSalvando(true);
    const r = await registrarContato(leadId, { resumo: `🤖 ${f.motivo}`, canal: f.canal, proximoEm: f.data });
    setSalvando(false);
    if (r?.error) return setErro(r.error);
    aoSalvarFollowup(f.data);
  }

  const f = sugestao?.followup ?? null;
  const jaNaAgenda = Boolean(f && proximoContato && proximoContato.slice(0, 10) === f.data);

  return (
    <div className="rounded-xl border border-violet-400/30 bg-violet-500/[0.06] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-violet-100">Próximo passo · IA</h3>
        <div className="flex items-center gap-2">
          {geradoEm && !carregando && <span className="text-[10px] text-slate-500">lido em {hora(geradoEm)}</span>}
          {sugestao && (
            <button
              type="button"
              onClick={() => carregar(true)}
              disabled={carregando}
              title="Lê tudo de novo agora (usa a IA)"
              className="rounded border border-violet-400/30 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
            >
              {carregando ? "Lendo…" : "Atualizar"}
            </button>
          )}
        </div>
      </div>

      {!sugestao && !lendoSalvo && (
        <div className="py-2">
          <p className="mb-2 text-xs text-slate-400">
            A IA lê a conversa, os follow-ups e a transcrição da última reunião e sugere o próximo passo.
          </p>
          <button
            type="button"
            onClick={() => carregar(false)}
            disabled={carregando}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {carregando ? "Lendo… (até 1 minuto)" : "Analisar com IA"}
          </button>
        </div>
      )}

      {sugestao && novidade && !carregando && (
        <p className="mb-2 text-[11px] text-amber-300">Tem novidade desde esta análise. Clique em Atualizar se quiser reler.</p>
      )}

      {erro && <p className="mb-2 text-xs text-red-300">{erro}</p>}

      {sugestao && (
        <div className={"space-y-3 " + (carregando ? "opacity-50" : "")}>
          {sugestao.alerta && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠ {sugestao.alerta}
            </p>
          )}

          <p className="text-sm leading-relaxed text-slate-200">{sugestao.situacao}</p>

          {sugestao.combinados.length > 0 && (
            <ul className="space-y-1">
              {sugestao.combinados.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-300">
                  <span className={c.quem === "cliente" ? "text-sky-300" : "text-violet-300"}>
                    {c.quem === "cliente" ? "Cliente" : "Você"}
                  </span>
                  <span className="flex-1">{c.acao}</span>
                  {c.quando && <span className="shrink-0 text-slate-500">{dia(c.quando)}</span>}
                </li>
              ))}
            </ul>
          )}

          {f && (
            <div className="rounded-lg border border-white/10 bg-navy-mid p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Follow-up sugerido{f.pedido_do_cliente ? " · combinado com o cliente" : ""}
              </p>
              <p className="mt-1 text-sm text-slate-100">
                <span className="font-semibold">{dia(f.data)}</span> · {CANAL[f.canal] ?? f.canal}
              </p>
              <p className="mt-0.5 text-xs text-slate-300">{f.motivo}</p>
              {jaNaAgenda ? (
                <p className="mt-2 text-xs text-emerald-300">✓ Já está na agenda</p>
              ) : (
                <button
                  type="button"
                  onClick={salvarFollowup}
                  disabled={salvando}
                  className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {salvando ? "Salvando…" : proximoContato ? `Trocar retorno para ${dia(f.data)}` : "Salvar follow-up"}
                </button>
              )}
            </div>
          )}

          {sugestao.mensagem && (
            <div className="rounded-lg border border-white/10 bg-navy-mid p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Mensagem sugerida</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{sugestao.mensagem}</p>
              <button
                type="button"
                onClick={() => aoUsarMensagem(sugestao.mensagem!)}
                className="mt-2 rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/10"
              >
                Usar no chat
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
