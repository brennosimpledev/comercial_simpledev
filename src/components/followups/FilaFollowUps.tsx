"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendLeadMessage, toggleLeadFlag } from "@/app/(app)/leads/actions";
import { adiarRetorno } from "@/app/(app)/leads/contatos";
import { gerarContinuidade } from "@/app/(app)/leads/continuidade";
import { EtiquetaBot } from "@/components/leads/EtiquetaBot";

type Fala = { em: string; texto: string };

export type ItemFila = {
  id: string;
  nome: string;
  estagio: string;
  botAvaliacao: string | null;
  ultimaDoCliente: Fala | null;
  ultimaNossa: Fala | null;
  tipo: "esperando" | "parado" | "regua";
  regua?: { enviados: number; total: number; proxima: string; titulo: string };
};

function haQuanto(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function Linha({ item }: { item: ItemFila }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [gerando, setGerando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);

  async function sugerir() {
    setGerando(true);
    const res = await gerarContinuidade(item.id, item.tipo === "parado" ? "retomada" : undefined);
    setGerando(false);
    if (res?.error || !res?.texto) return alert(res?.error ?? "Falha ao gerar a mensagem.");
    setRascunho(res.texto);
  }

  function run(fn: () => Promise<{ error?: string } | { ok: boolean } | undefined>) {
    startTransition(async () => {
      const res = (await fn()) as { error?: string } | undefined;
      if (res?.error) alert(res.error);
      else {
        setRascunho(null);
        router.refresh();
      }
    });
  }

  const fala = item.tipo === "esperando" ? item.ultimaDoCliente : item.ultimaNossa;

  return (
    <div className="rounded-xl border border-white/10 bg-navy p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leads/${item.id}`} className="text-sm font-medium text-white hover:text-brand">
          {item.nome}
        </Link>
        <EtiquetaBot avaliacao={item.botAvaliacao} />
        {fala && <span className="ml-auto text-xs text-slate-400">{haQuanto(fala.em)}</span>}
      </div>

      {item.tipo === "regua" && item.regua ? (
        <p className="mt-1 text-xs text-slate-400">
          {item.regua.enviados}/{item.regua.total} enviadas · próxima: {item.regua.titulo},{" "}
          {quando(item.regua.proxima)}
        </p>
      ) : (
        fala && (
          <p className="mt-1 line-clamp-2 text-sm text-slate-300">
            <span className="text-slate-500">{item.tipo === "esperando" ? "Cliente: " : "Nós: "}</span>
            {fala.texto}
          </p>
        )
      )}

      {rascunho !== null && (
        <textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-lg border border-white/15 bg-black/20 p-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.tipo === "regua" ? (
          <button
            onClick={() => run(() => toggleLeadFlag(item.id, "bot_pausado", true))}
            disabled={pending}
            title="Pausa o bot e a régua automática para este lead"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            Parar automático
          </button>
        ) : rascunho === null ? (
          <button
            onClick={sugerir}
            disabled={gerando || pending}
            className="rounded-lg bg-brand/20 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/30 disabled:opacity-50"
          >
            {gerando ? "Escrevendo…" : "✍️ Sugerir mensagem"}
          </button>
        ) : (
          <>
            <button
              onClick={() => run(() => sendLeadMessage(item.id, rascunho))}
              disabled={pending || !rascunho.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Enviar
            </button>
            <button
              onClick={sugerir}
              disabled={gerando || pending}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
            >
              {gerando ? "Escrevendo…" : "Gerar outra"}
            </button>
            <button
              onClick={() => setRascunho(null)}
              className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Descartar
            </button>
          </>
        )}
        {item.tipo !== "regua" && (
          <button
            onClick={() => run(() => adiarRetorno(item.id, 3))}
            disabled={pending}
            title="Some da fila por 3 dias"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            Adiar 3 dias
          </button>
        )}
        <Link
          href={`/leads/${item.id}`}
          className="ml-auto text-xs text-slate-400 hover:text-slate-200"
        >
          Abrir conversa →
        </Link>
      </div>
    </div>
  );
}

function Secao({
  titulo,
  ajuda,
  itens,
  vazio,
}: {
  titulo: string;
  ajuda: string;
  itens: ItemFila[];
  vazio: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">
          {titulo} <span className="font-normal text-slate-500">({itens.length})</span>
        </h2>
        <p className="text-xs text-slate-500">{ajuda}</p>
      </div>
      {itens.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-slate-500">{vazio}</p>
      ) : (
        itens.map((i) => <Linha key={i.id} item={i} />)
      )}
    </section>
  );
}

export function FilaFollowUps({
  esperando,
  parados,
  regua,
}: {
  esperando: ItemFila[];
  parados: ItemFila[];
  regua: ItemFila[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Secao
        titulo="Esperando sua resposta"
        ajuda="O cliente escreveu por último e ninguém respondeu há mais de 1h."
        itens={esperando}
        vazio="Ninguém esperando. 👌"
      />
      <Secao
        titulo="Pararam no meio da conversa"
        ajuda="Já conversaram, mas não respondem a nossa última mensagem há mais de 20h."
        itens={parados}
        vazio="Nenhuma conversa parada."
      />
      <Secao
        titulo="Na régua automática"
        ajuda="Nunca responderam. O sistema retoma sozinho às 9h e 14h em dia útil, 4 tentativas em uma semana."
        itens={regua}
        vazio="Ninguém na régua agora."
      />
    </div>
  );
}
