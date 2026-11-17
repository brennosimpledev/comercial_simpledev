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
  if (h < 1) return "agora";
  if (h < 24) return `${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function quando(iso: string) {
  return new Date(iso)
    .toLocaleString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    })
    .replace(".", "");
}

const amanhaBR = () => new Date(Date.now() - 3 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

function Icone({
  onClick,
  titulo,
  children,
  perigo,
  disabled,
}: {
  onClick: () => void;
  titulo: string;
  children: React.ReactNode;
  perigo?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      aria-label={titulo}
      className={
        "grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs transition disabled:opacity-40 " +
        (perigo ? "text-slate-500 hover:bg-red-500/15 hover:text-red-300" : "text-slate-400 hover:bg-white/10 hover:text-white")
      }
    >
      {children}
    </button>
  );
}

// Card do quadro. Compacto: nome, ha quanto tempo, a ultima fala em duas
// linhas e uma fileira de icones. Rascunho e data abrem dentro do card.
function Cartao({ item }: { item: ItemFila }) {
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

  const auto = item.tipo === "regua";
  const fala = item.tipo === "esperando" ? item.ultimaDoCliente : item.ultimaNossa;

  return (
    <div
      className={
        "rounded-lg border p-2.5 transition " +
        (auto ? "border-dashed border-white/10 bg-transparent" : "border-white/10 bg-navy") +
        (pending ? " opacity-50" : "")
      }
    >
      <div className="flex items-baseline gap-2">
        <Link
          href={`/leads/${item.id}`}
          className={"min-w-0 flex-1 truncate text-[13px] font-medium hover:text-brand " + (auto ? "text-slate-300" : "text-white")}
          title={item.nome}
        >
          {item.nome}
        </Link>
        {fala && <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{haQuanto(fala.em)}</span>}
      </div>

      {(item.botAvaliacao || item.retornoVencido) && (
        <div className="mt-1 flex flex-wrap gap-1">
          <EtiquetaBot avaliacao={item.botAvaliacao} />
          {item.retornoVencido && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              Retorno hoje
            </span>
          )}
        </div>
      )}

      {auto && item.regua ? (
        <p className="mt-1 text-[11px] text-slate-500">🤖 Régua manda {quando(item.regua.proxima)}</p>
      ) : (
        fala && (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-400">
            <span className="text-slate-500">{item.tipo === "esperando" ? "Cliente: " : "Nós: "}</span>
            {fala.texto}
          </p>
        )
      )}

      {rascunho !== null && (
        <div className="mt-2 flex flex-col gap-1.5">
          <textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-white/15 bg-black/30 p-2 text-xs text-slate-100 focus:border-brand focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => run(() => sendLeadMessage(item.id, rascunho))}
              disabled={pending || !rascunho.trim()}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Enviar
            </button>
            <button
              onClick={sugerir}
              disabled={gerando || pending}
              className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
            >
              {gerando ? "…" : "Outra"}
            </button>
            <button onClick={() => setRascunho(null)} className="px-1 text-xs text-slate-500 hover:text-slate-300">
              Descartar
            </button>
          </div>
        </div>
      )}

      {agendando && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={data}
            min={amanhaBR()}
            onChange={(e) => setData(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-1.5 py-1 text-xs text-slate-100 [color-scheme:dark]"
            aria-label="Data do retorno"
          />
          <button
            onClick={() =>
              run(() => registrarContato(item.id, { resumo: "Retorno agendado pela tela de follow-ups.", proximoEm: data }))
            }
            disabled={pending || !data}
            className="rounded-md bg-brand/20 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/30 disabled:opacity-40"
          >
            Salvar
          </button>
          <button onClick={() => setAgendando(false)} className="px-1 text-xs text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
      )}

      {rascunho === null && !agendando && (
        <div className="-mx-1 mt-1.5 flex items-center gap-0.5">
          {auto ? (
            <Icone titulo="Parar a régua automática deste lead" onClick={() => run(() => toggleLeadFlag(item.id, "bot_pausado", true))} disabled={pending}>
              ⏸
            </Icone>
          ) : (
            <button
              onClick={sugerir}
              disabled={gerando || pending}
              title="Escrever a mensagem com IA"
              className="h-7 rounded-md bg-brand/15 px-2 text-xs font-medium text-brand hover:bg-brand/25 disabled:opacity-50"
            >
              {gerando ? "Escrevendo…" : "✍️ Mensagem"}
            </button>
          )}
          <Icone titulo="Sai do quadro e volta em 3 dias" onClick={() => run(() => adiarRetorno(item.id, 3))} disabled={pending}>
            +3d
          </Icone>
          <Icone
            titulo="Agendar retorno: escolher o dia em que volta para o quadro"
            onClick={() => {
              setData(amanhaBR());
              setAgendando(true);
            }}
            disabled={pending}
          >
            📆
          </Icone>
          <span className="flex-1" />
          <Icone titulo="Desqualificar (sai do quadro)" onClick={desqualificar} disabled={pending} perigo>
            👎
          </Icone>
        </div>
      )}
    </div>
  );
}

function dataCurta(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}${a !== new Date().toISOString().slice(0, 4) ? `/${a.slice(2)}` : ""}`;
}

const ALTURA_COLUNA = "max-h-[calc(100vh-220px)]";

function Coluna({ numero, ultima, ajuda, itens }: { numero: number; ultima: boolean; ajuda?: string; itens: ItemFila[] }) {
  const doTime = itens.filter((i) => i.tipo !== "regua").length;
  const auto = itens.length - doTime;
  return (
    <section className="flex min-w-[180px] flex-1 flex-col rounded-xl border border-white/10 bg-white/[0.02]">
      <header className="border-b border-white/5 px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">
            {numero}º{ultima && <span className="ml-1 text-xs font-normal text-slate-400">última</span>}
          </h2>
          <span className="text-xs tabular-nums text-slate-500">{itens.length}</span>
        </div>
        {ajuda && <p className="truncate text-[11px] text-slate-500" title={`Régua: ${ajuda}`}>{ajuda}</p>}
        <p className="mt-0.5 text-[11px] tabular-nums">
          <span className={doTime ? "font-medium text-brand" : "text-slate-600"}>{doTime} Ronaldo</span>
          <span className="text-slate-600"> · {auto} auto</span>
        </p>
      </header>
      <div className={`flex flex-col gap-1.5 overflow-y-auto p-1.5 ${ALTURA_COLUNA}`}>
        {itens.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-slate-600">—</p>
        ) : (
          itens.map((i) => <Cartao key={i.id} item={i} />)
        )}
      </div>
    </section>
  );
}

function ColunaRetornos({ retornos }: { retornos: Retorno[] }) {
  const vencidos = retornos.filter((r) => r.vencido).length;
  return (
    <section className="flex min-w-[190px] flex-1 flex-col rounded-xl border border-amber-500/25 bg-amber-500/[0.03]">
      <header className="border-b border-white/5 px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">📆 Retornos</h2>
          <span className="text-xs tabular-nums text-slate-500">{retornos.length}</span>
        </div>
        <p className="text-[11px] text-slate-500">Voltam sozinhos no dia</p>
        {vencidos > 0 && <p className="mt-0.5 text-[11px] font-medium text-amber-300">{vencidos} vencidos</p>}
      </header>
      <div className={`flex flex-col gap-1 overflow-y-auto p-1.5 ${ALTURA_COLUNA}`}>
        {retornos.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-slate-600">—</p>
        ) : (
          retornos.map((r) => (
            <Link
              key={r.id}
              href={`/leads/${r.id}`}
              className="flex items-center gap-1.5 rounded-md border border-white/10 bg-navy px-2 py-1.5 text-xs hover:border-white/25"
              title={r.desqualificado ? `${r.nome} (desqualificado)` : r.nome}
            >
              <span className="min-w-0 flex-1 truncate text-slate-200">{r.nome}</span>
              {r.desqualificado && <span>👎</span>}
              <span className={"shrink-0 tabular-nums " + (r.vencido ? "font-semibold text-amber-300" : "text-slate-400")}>
                {dataCurta(r.proximo_contato!)}
              </span>
            </Link>
          ))
        )}
      </div>
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
  const doRonaldo = colunas.flat().filter((i) => i.tipo !== "regua").length;
  return (
    // Usa a largura toda da tela (como o Funil): 10 colunas nao cabem nos
    // 1280px do resto do CRM.
    <div className="flex flex-col gap-4 lg:mx-[calc(50%-50vw)] lg:px-6">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-300">
          <b className="text-white">{responder.length}</b> para responder agora
        </span>
        <span className="text-slate-300">
          <b className="text-brand">{doRonaldo}</b> follow-ups do Ronaldo
        </span>
        <span className="text-slate-500">Tracejado = a régua automática manda sozinha</span>
      </div>

      {responder.length > 0 && (
        <section className="rounded-xl border border-brand/30 bg-brand/[0.05] p-2.5">
          <h2 className="mb-2 px-1 text-sm font-semibold text-white">
            Responder agora <span className="font-normal text-slate-400">· o cliente escreveu e ninguém respondeu</span>
          </h2>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {responder.map((i) => (
              <Cartao key={i.id} item={i} />
            ))}
          </div>
        </section>
      )}

      <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        <div className="flex items-start gap-2">
          {colunas.map((itens, n) => (
            <Coluna key={n} numero={n + 1} ultima={n === colunas.length - 1} ajuda={titulos[n]} itens={itens} />
          ))}
          <ColunaRetornos retornos={retornos} />
        </div>
      </div>

      {frios.length > 0 && (
        <details className="rounded-xl border border-white/10 p-2.5">
          <summary className="cursor-pointer px-1 text-sm font-semibold text-slate-300">
            Frios <span className="font-normal text-slate-500">· sem conversa há mais de 7 dias ou passaram da 10ª ({frios.length})</span>
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {frios.map((i) => (
              <Cartao key={i.id} item={i} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
