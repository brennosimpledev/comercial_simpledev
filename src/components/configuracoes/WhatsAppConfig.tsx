"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  carregarWhatsApp,
  corrigirWebhook,
  criarInstanciaDoCloser,
  desconectarCloser,
  estadoAtual,
  pedirQr,
  type CartaoWhatsApp,
  type PainelWhatsApp,
} from "@/app/(app)/configuracoes/actions";

const TITULO = { sdr: "WhatsApp do SDR", closer: "WhatsApp do Closer" } as const;
const DESCRICAO = {
  sdr: "Linha do Ronaldo. Recebe os leads, o bot responde fora do expediente e a régua de follow-up sai por aqui.",
  closer:
    "Seu WhatsApp. O CRM guarda só as conversas com quem já é lead e você responde pelo chat do Funil. Não cria lead e não aciona o bot nem a régua.",
} as const;

const ESTADO: Record<string, { rotulo: string; cor: string }> = {
  open: { rotulo: "Conectado", cor: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  connecting: { rotulo: "Aguardando QR code", cor: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  close: { rotulo: "Desconectado", cor: "bg-red-500/15 text-red-300 ring-red-500/30" },
  inexistente: { rotulo: "Não criada", cor: "bg-slate-500/15 text-slate-300 ring-slate-500/30" },
  desconhecido: { rotulo: "Sem resposta da Evolution", cor: "bg-slate-500/15 text-slate-300 ring-slate-500/30" },
};

const WEBHOOK: Record<CartaoWhatsApp["webhook"], string> = {
  ok: "Recebendo mensagens no CRM",
  ausente: "Webhook não configurado: as mensagens não chegam no CRM",
  outro_endereco: "Webhook apontando para outro endereço",
  sem_segredo: "Webhook sem o segredo: o CRM recusa as mensagens",
  sem_evento: "Webhook sem o evento de mensagens (MESSAGES_UPSERT)",
};

function telefone(n: string | null) {
  if (!n) return null;
  const d = n.replace(/\D/g, "");
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d;
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function Chip({ estado }: { estado: string }) {
  const e = ESTADO[estado] ?? ESTADO.desconhecido;
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${e.cor}`}>{e.rotulo}</span>;
}

function Qr({ papel, qr, codigo, aoFechar }: { papel: CartaoWhatsApp["papel"]; qr: string | null; codigo?: string | null; aoFechar: (conectou: boolean) => void }) {
  const [imagem, setImagem] = useState(qr);
  const [estado, setEstado] = useState("connecting");
  // Em ref: o pai recria a funcao a cada render e isso reiniciaria o timer.
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  // Confere a conexao a cada 3s e renova o QR a cada 30s (ele expira).
  useEffect(() => {
    let vivo = true;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const e = await estadoAtual(papel);
      if (!vivo) return;
      setEstado(e);
      if (e === "open") {
        clearInterval(t);
        setTimeout(() => fechar.current(true), 1200);
        return;
      }
      if (n % 10 === 0) {
        const r = await pedirQr(papel);
        if (vivo && "qr" in r && r.qr) setImagem(r.qr);
      }
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [papel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="sd-card w-full max-w-sm p-5 text-center">
        <h3 className="mb-1 text-base font-semibold text-white">Conectar {TITULO[papel]}</h3>
        {estado === "open" ? (
          <p className="py-10 text-sm font-medium text-emerald-300">Conectado ✓</p>
        ) : (
          <>
            <p className="mb-4 text-xs text-slate-400">
              No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho, e aponte para o código.
            </p>
            {imagem ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagem} alt="QR code para conectar o WhatsApp" className="mx-auto w-64 rounded-lg bg-white p-2" />
            ) : (
              <p className="py-10 text-sm text-slate-400">Gerando o QR code…</p>
            )}
            {codigo && <p className="mt-3 text-xs text-slate-400">Ou use o código: <span className="font-mono text-slate-200">{codigo}</span></p>}
            <p className="mt-3 text-xs text-slate-500">O código é renovado sozinho a cada 30 segundos.</p>
          </>
        )}
        <button onClick={() => aoFechar(false)} className="sd-btn-ghost mt-4 w-full">
          Fechar
        </button>
      </div>
    </div>
  );
}

function Cartao({ c, recarregar }: { c: CartaoWhatsApp; recarregar: () => void }) {
  const [pending, startTransition] = useTransition();
  const [qr, setQr] = useState<{ qr: string | null; codigo?: string | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function run(fn: () => Promise<Record<string, unknown>>) {
    setErro(null);
    startTransition(async () => {
      const r = await fn();
      if (typeof r.error === "string") return setErro(r.error);
      if (r.conectado) return recarregar();
      if ("qr" in r) return setQr({ qr: (r.qr as string | null) ?? null, codigo: (r.codigo as string | null) ?? null });
      recarregar();
    });
  }

  const conectado = c.estado === "open";

  return (
    <div className="sd-card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{TITULO[c.papel]}</h2>
          <p className="mt-1 max-w-md text-xs text-slate-400">{DESCRICAO[c.papel]}</p>
        </div>
        <Chip estado={c.estado} />
      </div>

      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-400">Instância</dt>
        <dd className="font-mono text-slate-200">{c.nome || "—"}</dd>
        <dt className="text-slate-400">Número</dt>
        <dd className="text-slate-200">{telefone(c.numero) ?? "—"}{c.perfil ? <span className="text-slate-400"> · {c.perfil}</span> : null}</dd>
        {c.estado !== "inexistente" && (
          <>
            <dt className="text-slate-400">Webhook</dt>
            <dd className={c.webhook === "ok" ? "text-emerald-300" : "text-amber-300"}>{WEBHOOK[c.webhook]}</dd>
          </>
        )}
        {c.conversas && (
          <>
            <dt className="text-slate-400">Conversas</dt>
            <dd className="text-slate-200">
              {!c.conversas.tabelaOk ? (
                <span className="text-amber-300">Falta rodar a migration 0022_closer_messages.sql no Supabase</span>
              ) : c.conversas.mensagens === 0 ? (
                <span className="text-slate-400">Nenhuma mensagem com lead ainda</span>
              ) : (
                <>
                  {c.conversas.mensagens} mensagens de {c.conversas.leads} leads
                  {c.conversas.ultima && <span className="text-slate-400"> · última em {quando(c.conversas.ultima)}</span>}
                </>
              )}
            </dd>
          </>
        )}
      </dl>

      {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{erro}</p>}

      <div className="flex flex-wrap gap-2">
        {c.estado === "inexistente" && c.papel === "closer" && (
          <button className="sd-btn" disabled={pending} onClick={() => run(criarInstanciaDoCloser)}>
            {pending ? "Criando…" : "Criar instância e conectar"}
          </button>
        )}
        {c.estado !== "inexistente" && !conectado && (
          <button className="sd-btn" disabled={pending} onClick={() => run(() => pedirQr(c.papel))}>
            {pending ? "Gerando…" : "Conectar (QR code)"}
          </button>
        )}
        {c.estado !== "inexistente" && c.webhook !== "ok" && (
          <button
            className="sd-btn-ghost"
            disabled={pending}
            onClick={() => {
              if (c.papel === "sdr" && !confirm("Apontar o webhook do WhatsApp do SDR para este CRM? É por ele que chegam os leads e o bot responde.")) return;
              run(() => corrigirWebhook(c.papel));
            }}
          >
            Corrigir webhook
          </button>
        )}
        {c.papel === "closer" && conectado && (
          <button
            className="sd-btn-ghost"
            disabled={pending}
            onClick={() => {
              if (!confirm("Desconectar o seu WhatsApp do CRM? As conversas param de chegar até você conectar de novo.")) return;
              run(desconectarCloser);
            }}
          >
            Desconectar
          </button>
        )}
      </div>

      {qr && (
        <Qr
          papel={c.papel}
          qr={qr.qr}
          codigo={qr.codigo}
          aoFechar={() => {
            setQr(null);
            recarregar();
          }}
        />
      )}
    </div>
  );
}

export function WhatsAppConfig({ inicial }: { inicial: PainelWhatsApp }) {
  const [painel, setPainel] = useState(inicial);
  const [atualizando, startTransition] = useTransition();

  function recarregar() {
    startTransition(async () => {
      const r = await carregarWhatsApp();
      if (!("error" in r)) setPainel(r);
    });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">WhatsApp (Evolution)</h2>
        <button className="sd-btn-ghost text-xs" onClick={recarregar} disabled={atualizando}>
          {atualizando ? "Atualizando…" : "Atualizar status"}
        </button>
      </div>

      {painel.erroLista && (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{painel.erroLista}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {painel.cartoes.map((c) => (
          <Cartao key={c.papel} c={c} recarregar={recarregar} />
        ))}
      </div>

    </section>
  );
}
