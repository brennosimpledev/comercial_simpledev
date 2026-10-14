"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { updateLeadStage } from "@/app/(app)/leads/actions";
import { ArquivosPanel } from "@/components/leads/ArquivosPanel";
import { MeetingsPanel } from "@/components/leads/MeetingsPanel";
import { FollowUpPanel } from "@/components/funil/FollowUpPanel";
import {
  CLOSER_STAGES,
  STAGE_LABELS,
  colunaDoCloser,
  type Lead,
  type LeadArquivo,
  type LeadStage,
  type Meeting,
  type MeetingStatus,
} from "@/types/database";

export type ReuniaoResumo = Meeting;

const STATUS_REUNIAO: Record<MeetingStatus, { label: string; cls: string }> = {
  agendada: { label: "Agendada", cls: "bg-brand/15 text-brand" },
  realizada: { label: "Realizada", cls: "bg-emerald-500/15 text-emerald-400" },
  furada: { label: "Furada", cls: "bg-amber-500/15 text-amber-400" },
  cancelada: { label: "Cancelada", cls: "bg-red-500/15 text-red-400" },
};

// O Drive so embute video pela rota /preview.
function drivePreview(url: string): string | null {
  const marcador = "/file/d/";
  const i = url.indexOf(marcador);
  if (i === -1) return null;
  const id = url.slice(i + marcador.length).split("/")[0].split("?")[0];
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

function fmtReuniao(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

type ArquivoAtual = Pick<
  LeadArquivo,
  "id" | "lead_id" | "tipo" | "nome" | "versao" | "atual" | "valor" | "created_at"
>;

// Dias sem sair do estagio antes de o card acender. So onde a bola esta
// com o cliente: esperando resposta do escopo ou decisao da proposta.
const ALERTA_DIAS: Partial<Record<LeadStage, number>> = {
  escopo_enviado: 3,
  negociacao: 5,
  apresentacao_marcada: 7,
};

const COR_COLUNA: Partial<Record<LeadStage, string>> = {
  fechado: "text-emerald-400",
  perdido: "text-red-400",
};

// Dias ate o retorno marcado. Negativo = atrasado.
function diasAteRetorno(lead: Lead): number | null {
  if (!lead.proximo_contato) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [a, m, d] = lead.proximo_contato.slice(0, 10).split("-").map(Number);
  const alvo = new Date(a, m - 1, d);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

function rotuloRetorno(dias: number) {
  if (dias < 0) return `retorno atrasado ${-dias}d`;
  if (dias === 0) return "retorno hoje";
  if (dias === 1) return "retorno amanhã";
  return `retorno em ${dias}d`;
}

function diasParado(lead: Lead) {
  const base = lead.estagio_em ?? lead.updated_at ?? lead.created_at;
  if (!base) return 0;
  return Math.floor((Date.now() - new Date(base).getTime()) / 86_400_000);
}

function fmtValor(v: number | null | undefined) {
  if (v === null || v === undefined) return null;
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function Card({
  lead,
  arquivos,
  onAbrir,
}: {
  lead: Lead;
  arquivos: ArquivoAtual[];
  onAbrir: (l: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });
  const dias = diasParado(lead);
  const retorno = diasAteRetorno(lead);
  const limite = ALERTA_DIAS[colunaDoCloser(lead.estagio) ?? lead.estagio];
  // Com retorno marcado, o alerta passa a ser a data combinada.
  const atrasado =
    retorno !== null ? retorno <= 0 : limite !== undefined && dias >= limite;

  const escopo = arquivos.find((a) => a.tipo === "escopo");
  const proposta = arquivos.find((a) => a.tipo === "proposta");

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      onClick={() => onAbrir(lead)}
      className={
        "cursor-grab rounded-lg border bg-navy-mid p-3 transition " +
        (isDragging ? "opacity-50 " : "") +
        (atrasado ? "border-amber-500/50" : "border-white/10 hover:border-brand/40")
      }
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold text-slate-100">{lead.nome}</p>
        {fmtValor(proposta?.valor) && (
          <span className="shrink-0 text-xs font-semibold text-emerald-400">
            {fmtValor(proposta?.valor)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {escopo && (
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
            escopo v{escopo.versao}
          </span>
        )}
        {proposta && (
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
            proposta v{proposta.versao}
          </span>
        )}
        <span
          className={
            "rounded px-1.5 py-0.5 text-[10px] " +
            (atrasado ? "bg-amber-500/15 text-amber-400" : "bg-white/5 text-slate-500")
          }
        >
          {retorno !== null
            ? rotuloRetorno(retorno)
            : dias === 0
              ? "hoje"
              : `parado há ${dias}d`}
        </span>
      </div>
    </div>
  );
}

function Coluna({
  stage,
  leads,
  arquivos,
  onAbrir,
}: {
  stage: LeadStage;
  leads: Lead[];
  arquivos: ArquivoAtual[];
  onAbrir: (l: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = leads.reduce((soma, l) => {
    const p = arquivos.find((a) => a.lead_id === l.id && a.tipo === "proposta");
    return soma + (p?.valor ?? 0);
  }, 0);

  return (
    <div className="flex min-w-[190px] flex-1 flex-col">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className={"text-sm font-semibold " + (COR_COLUNA[stage] ?? "text-slate-200")}>
          {STAGE_LABELS[stage]}
        </h2>
        <span className="text-xs text-slate-500">
          {leads.length}
          {total > 0 && ` · ${fmtValor(total)}`}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={
          "flex min-h-[60vh] flex-col gap-2 rounded-xl p-2 transition " +
          (isOver ? "bg-brand/10 ring-2 ring-brand/40" : "bg-white/[0.03]")
        }
      >
        {leads.map((lead) => (
          <Card
            key={lead.id}
            lead={lead}
            arquivos={arquivos.filter((a) => a.lead_id === lead.id)}
            onAbrir={onAbrir}
          />
        ))}
        {leads.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-slate-600">Vazio</p>
        )}
      </div>
    </div>
  );
}

export function FunilBoard({
  initialLeads,
  atuais,
  reunioes = [],
  googleConnected = false,
}: {
  initialLeads: Lead[];
  atuais: ArquivoAtual[];
  reunioes?: ReuniaoResumo[];
  googleConnected?: boolean;
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [sel, setSel] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const [soRetornos, setSoRetornos] = useState(false);

  const paraHoje = useMemo(
    () => leads.filter((l) => {
      const d = diasAteRetorno(l);
      return d !== null && d <= 0;
    }),
    [leads]
  );

  const porColuna = useMemo(() => {
    const map = {} as Record<LeadStage, Lead[]>;
    for (const s of CLOSER_STAGES) map[s] = [];
    const visiveis = soRetornos
      ? leads.filter((l) => {
          const d = diasAteRetorno(l);
          return d !== null && d <= 0;
        })
      : leads;
    for (const lead of visiveis) {
      const col = colunaDoCloser(lead.estagio);
      if (col) map[col].push(lead);
    }
    // Quem tem retorno marcado vem primeiro, do mais atrasado ao mais
    // distante; depois os sem retorno, do mais parado ao mais recente.
    for (const s of CLOSER_STAGES) {
      map[s].sort((a, b) => {
        const da = diasAteRetorno(a);
        const db = diasAteRetorno(b);
        if (da !== null && db !== null) return da - db;
        if (da !== null) return -1;
        if (db !== null) return 1;
        return diasParado(b) - diasParado(a);
      });
    }
    return map;
  }, [leads, soRetornos]);

  // Muda o estagio pelo painel, sem precisar arrastar o card.
  async function mover(leadId: string, destino: LeadStage) {
    const anterior = leads;
    const agora = new Date().toISOString();
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, estagio: destino, estagio_em: agora } : l))
    );
    setSel((atual) =>
      atual && atual.id === leadId ? { ...atual, estagio: destino, estagio_em: agora } : atual
    );
    const res = await updateLeadStage(leadId, destino);
    if (res?.error) {
      setLeads(anterior);
      alert(res.error);
    }
  }

  async function aoSoltar(event: DragEndEvent) {
    const leadId = String(event.active.id);
    const destino = event.over?.id as LeadStage | undefined;
    if (!destino) return;
    const atual = leads.find((l) => l.id === leadId);
    if (!atual || colunaDoCloser(atual.estagio) === destino) return;

    const anterior = leads;
    const agora = new Date().toISOString();
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, estagio: destino, estagio_em: agora } : l))
    );

    const res = await updateLeadStage(leadId, destino);
    if (res?.error) {
      setLeads(anterior);
      alert(res.error);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Funil</h1>
          <p className="text-xs text-slate-400">
            Quem já sentou na reunião. Clique no card para o follow-up, os
            documentos e as reuniões.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSoRetornos((v) => !v)}
          className={
            "rounded-lg border px-3 py-1.5 text-sm transition " +
            (soRetornos
              ? "border-amber-500 bg-amber-500/15 text-amber-400"
              : "border-white/15 text-slate-300 hover:bg-white/5")
          }
        >
          {paraHoje.length === 0
            ? "Nenhum retorno para hoje"
            : `${paraHoje.length} para falar hoje`}
        </button>
      </div>

      <DndContext sensors={sensors} onDragEnd={aoSoltar}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 lg:mx-[calc(50%-50vw)] lg:px-6">
          {CLOSER_STAGES.map((stage) => (
            <Coluna
              key={stage}
              stage={stage}
              leads={porColuna[stage]}
              arquivos={atuais}
              onAbrir={setSel}
            />
          ))}
        </div>
      </DndContext>

      {sel && (
        <div
          className="fixed inset-0 z-20 flex justify-end bg-black/50"
          onClick={() => setSel(null)}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{sel.nome}</h2>
                <p className="text-xs text-slate-400">
                  {STAGE_LABELS[colunaDoCloser(sel.estagio) ?? sel.estagio]} ·{" "}
                  {diasParado(sel) === 0 ? "hoje" : `parado há ${diasParado(sel)}d`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSel(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mb-4">
              <p className="sd-label">Mover para</p>
              <div className="flex flex-wrap gap-1.5">
                {CLOSER_STAGES.map((stage) => {
                  const aqui = colunaDoCloser(sel.estagio) === stage;
                  const cor =
                    stage === "fechado"
                      ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                      : stage === "perdido"
                        ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
                        : "border-white/15 text-slate-300 hover:bg-white/5";
                  return (
                    <button
                      key={stage}
                      type="button"
                      disabled={aqui}
                      onClick={() => mover(sel.id, stage)}
                      className={
                        "rounded-lg border px-2.5 py-1 text-xs transition " +
                        (aqui ? "border-brand bg-brand/15 text-brand" : cor)
                      }
                    >
                      {STAGE_LABELS[stage]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              {sel.whatsapp && (
                <a
                  href={`https://wa.me/${sel.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sd-btn-ghost px-2 py-1"
                >
                  WhatsApp
                </a>
              )}
              <Link href={`/leads/${sel.id}`} className="sd-btn-ghost px-2 py-1">
                Ficha completa
              </Link>
            </div>

            <div className="sd-card mb-4 p-4">
              <FollowUpPanel
                leadId={sel.id}
                proximoContato={sel.proximo_contato}
                aoMudar={(proximo) => {
                  setLeads((prev) =>
                    prev.map((l) =>
                      l.id === sel.id ? { ...l, proximo_contato: proximo } : l
                    )
                  );
                  setSel((atual) =>
                    atual ? { ...atual, proximo_contato: proximo } : atual
                  );
                }}
              />
            </div>

            <div className="sd-card mb-4 p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-200">Reuniões</h3>
              {reunioes.filter((r) => r.lead_id === sel.id).length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma reunião registrada.</p>
              ) : (
                <ul className="space-y-1.5">
                  {reunioes
                    .filter((r) => r.lead_id === sel.id)
                    .map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center gap-2 rounded-lg border border-white/5 bg-navy-mid px-3 py-2"
                      >
                        <span className="shrink-0 text-xs text-slate-300">
                          {fmtReuniao(r.starts_at)}
                        </span>
                        <span
                          className={
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] " +
                            STATUS_REUNIAO[r.status].cls
                          }
                        >
                          {STATUS_REUNIAO[r.status].label}
                        </span>
                        <span className="flex-1 truncate text-xs text-slate-500">
                          {r.titulo ?? ""}
                        </span>
                        {r.transcricao && (
                          <a
                            href={r.transcricao}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[11px] text-slate-300 hover:text-brand"
                          >
                            Transcrição
                          </a>
                        )}
                        {r.gravacao && (
                          <a
                            href={r.gravacao}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[11px] text-emerald-400 hover:underline"
                          >
                            Gravação
                          </a>
                        )}
                        {r.meet_link && (
                          <a
                            href={r.meet_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[11px] text-brand hover:underline"
                          >
                            Meet
                          </a>
                        )}
                        <Link
                          href={`/reunioes?m=${r.id}`}
                          className="shrink-0 text-[11px] text-slate-400 hover:text-brand"
                          title="Abrir na agenda"
                        >
                          Agenda
                        </Link>
                      </li>
                    ))}
                </ul>
              )}

              {(() => {
                // Video da primeira reuniao que tiver gravacao, ja embutido.
                const comVideo = reunioes
                  .filter((r) => r.lead_id === sel.id && r.gravacao)
                  .map((r) => drivePreview(r.gravacao as string))
                  .find(Boolean);
                return comVideo ? (
                  <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
                    <iframe
                      src={comVideo}
                      className="aspect-video w-full"
                      allow="autoplay"
                      title="Gravação da reunião"
                    />
                  </div>
                ) : null;
              })()}

              <div className="mt-3 border-t border-white/5 pt-3">
                <MeetingsPanel
                  leadId={sel.id}
                  meetings={reunioes.filter((r) => r.lead_id === sel.id)}
                  googleConnected={googleConnected}
                  hasWhatsapp={Boolean(sel.whatsapp)}
                  leadName={sel.nome}
                  leadEmail={sel.email}
                />
              </div>
            </div>

            <div className="sd-card p-4">
              <ArquivosPanel leadId={sel.id} />
            </div>

            {sel.anotacoes && (
              <div className="sd-card mt-4 p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Anotações
                </h3>
                <p className="whitespace-pre-wrap text-sm text-slate-300">{sel.anotacoes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
