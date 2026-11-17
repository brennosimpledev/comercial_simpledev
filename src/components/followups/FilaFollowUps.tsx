"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendLeadMessage, toggleLeadFlag } from "@/app/(app)/leads/actions";
import { adiarRetorno, registrarContato } from "@/app/(app)/leads/contatos";
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
  /** Follow-ups do time ja feitos desde a ultima fala do cliente. */
  feitos?: number;
  /** Tinha retorno agendado e o dia chegou. */
  retornoVencido?: boolean;
};

export type Retorno = {
  id: string;
  nome: string;
  estagio: string;
  desqualificado: boolean;
  proximo_contato: string | null;
  vencido?: boolean;
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

const amanhaBR = () => new Date(Date.now() - 3 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

function Linha({ item }: { item: ItemFila }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [gerando, setGerando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [agendando, setAgendando] = useState(false);
  const [data, setData] = useState("");

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
        setAgendando(false);
        router.refresh();
      }
    });
  }

  function desqualificar() {
    if (confirm(`Desqualificar ${item.nome}? Sai do quadro e a Meta recebe o sinal de lead ruim.`)) {
      run(() => toggleLeadFlag(item.id, "desqualificado", true));
    }
  }

  const fala = item.tipo === "esperando" ? item.ultimaDoCliente : item.ultimaNossa;

  return (
    <div className={"rounded-xl border border-white/10 bg-navy p-3 " + (pending ? "opacity-60" : "")}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leads/${item.id}`} className="text-sm font-medium text-white hover:text-brand">
          {item.nome}
        </Link>
        <EtiquetaBot avaliacao={item.botAvaliacao} />
        {item.retornoVencido && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            Retorno hoje
          </span>
        )}
        {fala && <span className="ml-auto text-xs text-slate-400">{haQuanto(fala.em)}</span>}
      </div>

      {item.tipo === "regua" && item.regua ? (
        <p className="mt-1 text-xs text-slate-400">
          🤖 Automático · {item.regua.enviados}/{item.regua.total} enviadas · próxima {quando(item.regua.proxima)}
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
        <Link href={`/leads/${item.id}`} className="ml-auto text-xs text-slate-400 hover:text-slate-200">
          Abrir →
        </Link>
      </div>

      {/* Tirar do quadro: retorno numa data (volta sozinho no dia) ou
          desqualificar (sai de vez e a Meta recebe o sinal). */}
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-white/5 pt-2">
        {agendando ? (
          <>
            <input
              type="date"
              value={data}
              min={amanhaBR()}
              onChange={(e) => setData(e.target.value)}
              className="rounded-md border border-white/15 bg-black/20 px-1.5 py-1 text-xs text-slate-100 [color-scheme:dark]"
              aria-label="Data do retorno"
            />
            <button
              onClick={() =>
                run(() =>
                  registrarContato(item.id, { resumo: "Retorno agendado pela tela de follow-ups.", proximoEm: data })
                )
              }
              disabled={pending || !data}
              className="rounded-md bg-brand/20 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/30 disabled:opacity-40"
            >
              Salvar
            </button>
            <button onClick={() => setAgendando(false)} className="px-1 text-xs text-slate-500 hover:text-slate-300">
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => run(() => adiarRetorno(item.id, 3))}
              disabled={pending}
              title="Sai do quadro e volta daqui a 3 dias"
              className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
            >
              +3 dias
            </button>
            <button
              onClick={() => {
                setData(amanhaBR());
                setAgendando(true);
              }}
              disabled={pending}
              title="Escolher o dia em que o lead volta para o quadro"
              className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
            >
              📆 Agendar retorno
            </button>
            <button
              onClick={desqualificar}
              disabled={pending}
              className="ml-auto rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
            >
              👎 Desqualificar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function dataCurta(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}${a !== new Date().toISOString().slice(0, 4) ? `/${a.slice(2)}` : ""}`;
}

function Coluna({
  titulo,
  ajuda,
  itens,
  destaque,
}: {
  titulo: string;
  ajuda?: string;
  itens: ItemFila[];
  destaque?: boolean;
}) {
  const doTime = itens.filter((i) => i.tipo !== "regua").length;
  const auto = itens.length - doTime;
  return (
    <section
      className={
        "flex w-80 shrink-0 flex-col gap-2 rounded-xl border p-2.5 " +
        (destaque ? "border-brand/30 bg-brand/[0.04]" : "border-white/10 bg-white/[0.02]")
      }
    >
      <header className="px-1">
        <h2 className="text-sm font-semibold text-slate-200">
          {titulo} <span className="font-normal text-slate-500">({itens.length})</span>
        </h2>
        {ajuda && <p className="text-[11px] text-slate-500">Régua: {ajuda.toLowerCase()}</p>}
        {itens.length > 0 && (
          <p className="text-[11px] text-slate-500">
            {doTime} para o Ronaldo · {auto} automático{auto === 1 ? "" : "s"}
          </p>
        )}
      </header>
      {itens.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 p-3 text-center text-xs text-slate-600">Vazio</p>
      ) : (
        itens.map((i) => <Linha key={i.id} item={i} />)
      )}
    </section>
  );
}

function ColunaRetornos({ retornos }: { retornos: Retorno[] }) {
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-2.5">
      <header className="px-1">
        <h2 className="text-sm font-semibold text-slate-200">
          📆 Retornos agendados <span className="font-normal text-slate-500">({retornos.length})</span>
        </h2>
        <p className="text-[11px] text-slate-500">
          Saem do quadro até o dia marcado e voltam sozinhos. Inclui desqualificados com retorno.
        </p>
      </header>
      {retornos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 p-3 text-center text-xs text-slate-600">
          Nenhum retorno
        </p>
      ) : (
        retornos.map((r) => (
          <Link
            key={r.id}
            href={`/leads/${r.id}`}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy px-3 py-2 text-sm hover:border-white/25"
          >
            <span className="min-w-0 flex-1 truncate text-slate-200">{r.nome}</span>
            {r.desqualificado && <span title="Desqualificado">👎</span>}
            <span
              className={"shrink-0 text-xs tabular-nums " + (r.vencido ? "font-semibold text-amber-300" : "text-slate-400")}
            >
              {r.vencido ? `${dataCurta(r.proximo_contato!)} · venceu` : dataCurta(r.proximo_contato!)}
            </span>
          </Link>
        ))
      )}
    </section>
  );
}

export function FilaFollowUps({
  responder,
  colunas,
  titulos,
  frios,
  retornos,
}: {
  responder: ItemFila[];
  colunas: ItemFila[][];
  titulos: string[];
  frios: ItemFila[];
  retornos: Retorno[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">
            Responder agora <span className="font-normal text-slate-500">({responder.length})</span>
          </h2>
          <p className="text-xs text-slate-500">O cliente escreveu por último e ninguém respondeu há mais de 1h.</p>
        </div>
        {responder.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-slate-500">
            Ninguém esperando. 👌
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {responder.map((i) => (
              <Linha key={i.id} item={i} />
            ))}
          </div>
        )}
      </section>

      <div className="-mx-4 overflow-x-auto px-4 pb-3">
        <div className="flex items-start gap-3">
          {colunas.map((itens, n) => (
            <Coluna
              key={n}
              titulo={n === colunas.length - 1 ? `${n + 1}º · última tentativa` : `${n + 1}º follow-up`}
              ajuda={titulos[n]}
              itens={itens}
              destaque={n === 0}
            />
          ))}
          <ColunaRetornos retornos={retornos} />
        </div>
      </div>

      {frios.length > 0 && (
        <details className="rounded-xl border border-white/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-300">
            Frios: sem conversa há mais de 7 dias ou já passaram da 10ª tentativa{" "}
            <span className="font-normal text-slate-500">({frios.length})</span>
          </summary>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {frios.map((i) => (
              <Linha key={i.id} item={i} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
