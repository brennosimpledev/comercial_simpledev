"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MarketingPanel } from "./MarketingPanel";
import { ATALHOS, PeriodoFiltro, intervaloDoAtalho, type Atalho } from "./PeriodoFiltro";
import { TrackingCell } from "./TrackingCell";
import { deleteLead } from "@/app/(app)/leads/actions";
import {
  ORIGIN_LABELS,
  STAGE_LABELS,
  type Lead,
  type LeadOrigin,
} from "@/types/database";
import { EtiquetaBot } from "@/components/leads/EtiquetaBot";

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export type ReuniaoDoLead = { lead_id: string; starts_at: string; status: string };

const ultimos8 = (w: string | null | undefined) => (w ?? "").replace(/D/g, "").slice(-8);

// Icone de reuniao: a proxima marcada, ou a ultima que aconteceu. Reuniao
// cancelada nao conta. Furada aparece apagada.
function IconeReuniao({ reunioes }: { reunioes: ReuniaoDoLead[] }) {
  const validas = reunioes.filter((r) => r.status !== "cancelada");
  if (!validas.length) return <span className="text-slate-700">·</span>;
  const agora = Date.now();
  const proxima = validas.find((r) => r.status === "agendada" && new Date(r.starts_at).getTime() >= agora - 3600_000);
  const r = proxima ?? validas[validas.length - 1];
  const quando = new Date(r.starts_at).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const situacao = proxima ? "marcada" : r.status === "realizada" ? "realizada" : r.status === "furada" ? "faltou" : r.status;
  const titulo =
    `Reunião ${situacao}: ${quando}` + (validas.length > 1 ? ` (${validas.length} reuniões no total)` : "");
  return (
    <span title={titulo} aria-label={titulo} className={proxima ? "" : r.status === "realizada" ? "opacity-70" : "opacity-35 grayscale"}>
      {proxima ? "📅" : r.status === "realizada" ? "✅" : "📅"}
    </span>
  );
}

function StatusIcon({ lead }: { lead: Lead }) {
  if (lead.desqualificado)
    return <span title="Desqualificado">👎</span>;
  if (lead.qualificado) return <span title="Qualificado">👍</span>;
  if (lead.sem_resposta) return <span title="Sem resposta">🛌</span>;
  return <span className="text-slate-600">—</span>;
}

export function LeadsView({
  leads,
  reunioes = [],
}: {
  leads: Lead[];
  reunioes?: ReuniaoDoLead[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Os filtros vivem na URL para sobreviverem a abrir um lead e voltar.
  const sp = useSearchParams();
  // Periodo: atalho na URL (?p=30d) se recalcula todo dia; datas a mao
  // ficam como ?de=&ate=. Sem nada, ultimos 7 dias.
  const [atalho, setAtalho] = useState<Atalho>(() => {
    const p = sp.get("p") as Atalho | null;
    if (p && ATALHOS.some((a) => a.v === p)) return p;
    return sp.get("de") && sp.get("ate") ? "personalizado" : "7d";
  });
  const inicial = atalho === "personalizado" ? { de: sp.get("de")!, ate: sp.get("ate")! } : intervaloDoAtalho(atalho);
  const [from, setFrom] = useState(inicial.de);
  const [to, setTo] = useState(inicial.ate);

  function escolherAtalho(a: Atalho) {
    setAtalho(a);
    if (a === "personalizado") return; // mantem as datas atuais para editar
    const i = intervaloDoAtalho(a);
    setFrom(i.de);
    setTo(i.ate);
  }
  const [origem, setOrigem] = useState<"" | LeadOrigin>(
    (sp.get("origem") as LeadOrigin) ?? ""
  );

  // replaceState em vez de router.replace: a filtragem e toda no cliente,
  // entao nao ha motivo para bater no servidor a cada tecla.
  useEffect(() => {
    const p = new URLSearchParams();
    if (atalho !== "personalizado") p.set("p", atalho);
    else {
      if (from) p.set("de", from);
      if (to) p.set("ate", to);
    }
    if (origem) p.set("origem", origem);
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  }, [atalho, from, to, origem]);

  const filtered = useMemo(() => {
    // Dias de Brasilia, como no painel de marketing.
    const start = new Date(from + "T00:00:00-03:00");
    const end = new Date(to + "T23:59:59.999-03:00");
    return leads.filter((l) => {
      const c = new Date(l.created_at);
      if (c < start || c > end) return false;
      if (origem && l.origem !== origem) return false;
      // Cliente tem aba propria; aqui ele so poluiria o filtered.
      if (l.ja_cliente) return false;
      return true;
    });
  }, [leads, from, to, origem]);


  // Reunioes por lead. O mesmo cliente costuma ter dois cards (formulario
  // e conversa): a reuniao aparece nos dois, pelo telefone.
  const reunioesDe = useMemo(() => {
    const porId = new Map<string, ReuniaoDoLead[]>();
    for (const r of reunioes) porId.set(r.lead_id, [...(porId.get(r.lead_id) ?? []), r]);
    const porTelefone = new Map<string, ReuniaoDoLead[]>();
    for (const l of leads) {
      const rs = porId.get(l.id);
      const k = ultimos8(l.whatsapp);
      if (rs && k.length === 8) porTelefone.set(k, [...(porTelefone.get(k) ?? []), ...rs]);
    }
    return (l: Lead) => {
      const k = ultimos8(l.whatsapp);
      const rs = (k.length === 8 ? porTelefone.get(k) : undefined) ?? porId.get(l.id) ?? [];
      return [...rs].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    };
  }, [reunioes, leads]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [filtered]
  );

  function handleDelete(id: string, nome: string) {
    if (!confirm(`Excluir o lead "${nome}"? Essa ação não pode ser desfeita.`))
      return;
    startTransition(async () => {
      const res = await deleteLead(id);
      if (res?.error) alert(res.error);
      else router.refresh();
    });
  }

  const inputCls =
    "rounded-lg border border-white/10 bg-[#0b2a49] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-brand";

  return (
    <div className="space-y-4">
      {/* Funil completo (Meta + CRM) com o grafico que muda pela etapa
          clicada; o periodo fica dentro do card. */}
      <MarketingPanel
        de={from}
        ate={to}
        periodo={
          <PeriodoFiltro
            atalho={atalho}
            de={from}
            ate={to}
            onAtalho={escolherAtalho}
            onDatas={(de, ate) => {
              setFrom(de);
              setTo(ate);
            }}
          />
        }
      />


      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={origem}
          onChange={(e) => setOrigem(e.target.value as "" | LeadOrigin)}
          className={inputCls}
        >
          <option value="">Todas as origens</option>
          {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Link
          href="/leads/novo"
          className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark"
        >
          + Lead
        </Link>
      </div>

      <div className="sd-card overflow-hidden">
        {sorted.map((lead) => (
          <div
            key={lead.id}
            className={
              "flex items-center gap-3 border-b border-white/5 px-4 py-3 text-sm last:border-b-0 " +
              (lead.qualificado
                ? "bg-brand/5 hover:bg-brand/10"
                : "hover:bg-white/5")
            }
          >
            <div className="w-48 shrink-0 font-medium text-white">
              <Link href={`/leads/${lead.id}`} className="hover:text-brand">
                {lead.nome}
              </Link>
              <div className="mt-0.5">
                <EtiquetaBot avaliacao={lead.bot_avaliacao} />
              </div>
            </div>
            <div className="w-36 shrink-0 text-slate-300">
              {lead.whatsapp ?? "—"}
            </div>
            <div className="hidden flex-1 truncate text-slate-400 md:block">
              {lead.email ?? ""}
            </div>
            <div className="w-32 shrink-0 text-slate-400">
              {fmtDateTime(lead.created_at)}
            </div>
            <div className="w-28 shrink-0 text-slate-300">
              {ORIGIN_LABELS[lead.origem]}
            </div>
            <div className="w-20 shrink-0 text-center text-slate-400">
              {STAGE_LABELS[lead.estagio]}
            </div>
            <div className="w-8 shrink-0 text-center text-base">
              <StatusIcon lead={lead} />
            </div>
            <div className="w-8 shrink-0 text-center text-base">
              <IconeReuniao reunioes={reunioesDe(lead)} />
            </div>
            <div className="w-8 shrink-0 text-center">
              <TrackingCell lead={lead} />
            </div>
            <div className="flex w-16 shrink-0 items-center justify-end gap-2">
              <Link
                href={`/leads/${lead.id}`}
                title="Abrir conversa"
                className="text-slate-400 hover:text-brand"
              >
                💬
              </Link>
              <button
                onClick={() => handleDelete(lead.id, lead.nome)}
                disabled={pending}
                title="Excluir"
                className="text-slate-400 hover:text-red-400 disabled:opacity-50"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nenhum lead no período/origem selecionado.
          </p>
        )}
      </div>
    </div>
  );
}
