"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  updateMeetingStatus,
  uploadTranscricao,
  deleteTranscricao,
  rescheduleMeeting,
  scheduleMeeting,
  buscarArquivosDoMeet,
  vincularTranscricao,
  vincularGravacao,
} from "@/app/(app)/leads/meetings";
import { updateLeadNotes } from "@/app/(app)/leads/actions";
import {
  ORIGIN_LABELS,
  type LeadOrigin,
  type MeetingStatus,
  type MeetingWithLead,
} from "@/types/database";

// pill = 1a reuniao. pillFollow = 2a em diante, tom mais fechado da mesma
// cor: mantem a leitura do status e ainda destaca que e follow-up.
const STATUS_CFG: Record<
  MeetingStatus,
  { label: string; bg: string; text: string; pill: string; pillFollow: string }
> = {
  agendada: {
    label: "Agendada",
    bg: "bg-brand/15",
    text: "text-brand",
    pill: "bg-brand",
    pillFollow: "bg-blue-800",
  },
  realizada: {
    label: "Realizada",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    pill: "bg-emerald-500",
    pillFollow: "bg-emerald-800",
  },
  furada: {
    label: "Furada",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    pill: "bg-amber-500",
    pillFollow: "bg-amber-700",
  },
  cancelada: {
    label: "Cancelada",
    bg: "bg-red-500/15",
    text: "text-red-400",
    pill: "bg-red-500/60",
    pillFollow: "bg-red-900/70",
  },
};

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const WDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// Cor da tag de origem. Origem desconhecida cai no cinza.
const ORIGEM_CFG: Record<string, string> = {
  google_ads: "bg-blue-500/15 text-blue-300",
  meta_ads: "bg-indigo-500/15 text-indigo-300",
  indicacao: "bg-emerald-500/15 text-emerald-300",
  organico: "bg-teal-500/15 text-teal-300",
  whatsapp: "bg-green-500/15 text-green-300",
  workana: "bg-amber-500/15 text-amber-300",
  outro: "bg-slate-500/15 text-slate-300",
};

function ordinalBR(n: number) {
  return `${n}ª reunião`;
}

type ArquivoDrive = {
  id: string;
  name: string;
  webViewLink: string;
  tipo: "transcricao" | "gravacao" | "outro";
};

// O Drive expoe o player em /file/d/{id}/preview. O webViewLink termina em
// /view, entao basta trocar o sufixo.
function drivePreview(url: string): string | null {
  const m = url.match(/\/file\/d\/([^/]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
}

function primeiroNome(nome: string) {
  return (nome ?? "").trim().split(/\s+/)[0] || "cliente";
}

// wa.me exige so digitos, com DDI.
function waLink(whatsapp: string) {
  const d = whatsapp.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("55") ? d : "55" + d}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function dKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function meetKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

function calGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const dow = first.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  const days: { date: Date; key: string; cur: boolean }[] = [];
  for (let i = -offset; i < 42 - offset; i++) {
    const d = new Date(year, month, 1 + i);
    days.push({ date: d, key: dKey(d), cur: d.getMonth() === month });
  }
  if (days.length > 35 && days.slice(35).every((d) => !d.cur))
    return days.slice(0, 35);
  return days;
}

// Extrai o id que vem logo depois de um marcador de caminho do Drive.
function idApos(url: string, marcador: string): string | null {
  const i = url.indexOf(marcador);
  if (i === -1) return null;
  const id = url.slice(i + marcador.length).split("/")[0].split("?")[0];
  return id || null;
}

// Link de download direto. Google Docs nao serve o arquivo pela URL de
// edicao - precisa da rota de export. Arquivo nosso no Storage ja e direto.
function downloadUrl(url: string): string {
  const doc = idApos(url, "/document/d/");
  if (doc) {
    return `https://docs.google.com/document/d/${doc}/export?format=pdf`;
  }
  const arquivo = idApos(url, "/file/d/");
  if (arquivo) {
    return `https://drive.google.com/uc?export=download&id=${arquivo}`;
  }
  return url;
}

function fileNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    // Link do Drive termina em /edit ou /view; o nome nao esta na URL.
    if (u.hostname.endsWith("google.com")) {
      return u.pathname.includes("/document/")
        ? "Transcrição no Google Docs"
        : "Arquivo no Google Drive";
    }
    return decodeURIComponent(u.pathname.split("/").pop() || "arquivo");
  } catch {
    return "arquivo";
  }
}

function genSlots(startH: number, endH: number) {
  const slots: string[] = [];
  for (let h = startH; h < endH; h++) {
    for (let m = 0; m < 60; m += 10) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}

export function MeetingsCalendar({
  meetings,
}: {
  meetings: MeetingWithLead[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const now = new Date();
  const [vYear, setVYear] = useState(now.getFullYear());
  const [vMonth, setVMonth] = useState(now.getMonth());
  const [sel, setSel] = useState<MeetingWithLead | null>(null);
  const [resumo, setResumo] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescDate, setRescDate] = useState("");
  const [rescTime, setRescTime] = useState("");
  const [showNova, setShowNova] = useState(false);
  const [novaDate, setNovaDate] = useState("");
  const [novaTime, setNovaTime] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [achados, setAchados] = useState<ArquivoDrive[] | null>(null);

  const today = dKey(now);
  const grid = useMemo(() => calGrid(vYear, vMonth), [vYear, vMonth]);

  const byDate = useMemo(() => {
    const m: Record<string, MeetingWithLead[]> = {};
    for (const mt of meetings) {
      const k = meetKey(mt.starts_at);
      (m[k] ??= []).push(mt);
    }
    for (const k of Object.keys(m))
      m[k].sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
    return m;
  }, [meetings]);

  // Numero da reuniao dentro do historico daquele lead. Canceladas nao
  // entram na contagem: "2a reuniao" quando a primeira foi cancelada confunde.
  const ordem = useMemo(() => {
    const porLead: Record<string, MeetingWithLead[]> = {};
    for (const m of meetings) {
      if (m.status === "cancelada") continue;
      (porLead[m.lead_id] ??= []).push(m);
    }
    const mapa: Record<string, number> = {};
    for (const lista of Object.values(porLead)) {
      lista
        .slice()
        .sort(
          (a, b) =>
            new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
        )
        .forEach((m, i) => {
          mapa[m.id] = i + 1;
        });
    }
    return mapa;
  }, [meetings]);

  const cnt = {
    agendada: meetings.filter((m) => m.status === "agendada").length,
    realizada: meetings.filter((m) => m.status === "realizada").length,
    furada: meetings.filter((m) => m.status === "furada").length,
  };
  const done = cnt.realizada + cnt.furada;
  const taxa = done > 0 ? Math.round((cnt.realizada / done) * 100) : null;

  useEffect(() => {
    if (!sel) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sel]);

  function prev() {
    if (vMonth === 0) {
      setVMonth(11);
      setVYear((y) => y - 1);
    } else {
      setVMonth((m) => m - 1);
    }
  }
  function next() {
    if (vMonth === 11) {
      setVMonth(0);
      setVYear((y) => y + 1);
    } else {
      setVMonth((m) => m + 1);
    }
  }
  function goToday() {
    const n = new Date();
    setVYear(n.getFullYear());
    setVMonth(n.getMonth());
  }

  function openMeeting(m: MeetingWithLead) {
    setSel(m);
    setResumo(m.leads.anotacoes ?? "");
    setShowReschedule(false);
    setRescDate("");
    setRescTime("");
    setShowNova(false);
    setNovaDate("");
    setNovaTime("");
    setCopiado(false);
    setAchados(null);
    setBuscando(false);
  }

  function salvar() {
    if (!sel) return;
    startTransition(async () => {
      const res = await updateLeadNotes(sel.leads.id, resumo);
      if (res?.error) alert(res.error);
      else {
        setSel(null);
        router.refresh();
      }
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!sel || !e.target.files?.[0]) return;
    const fd = new FormData();
    fd.append("file", e.target.files[0]);
    startTransition(async () => {
      const res = await uploadTranscricao(sel.id, fd);
      if (res?.error) alert(res.error);
      else {
        setSel({ ...sel, transcricao: res.url ?? null });
        router.refresh();
      }
    });
  }

  function removeFile() {
    if (!sel || !confirm("Remover transcrição?")) return;
    startTransition(async () => {
      const res = await deleteTranscricao(sel.id);
      if (res?.error) alert(res.error);
      else {
        setSel({ ...sel, transcricao: null });
        router.refresh();
      }
    });
  }

  function marcar(st: "realizada" | "furada" | "cancelada") {
    if (!sel) return;
    const msgs = {
      realizada: "Marcar como realizada?",
      furada: "Marcar como furada?",
      cancelada: "Cancelar reunião?",
    };
    if (!confirm(msgs[st])) return;
    startTransition(async () => {
      const res = await updateMeetingStatus(sel.id, st);
      if (res?.error) alert(res.error);
      else {
        setSel(null);
        router.refresh();
      }
    });
  }

  function buscarNoDrive() {
    if (!sel) return;
    setBuscando(true);
    setAchados(null);
    startTransition(async () => {
      const res = await buscarArquivosDoMeet(sel.id);
      setBuscando(false);
      if (res?.error) {
        alert(res.error);
        return;
      }
      setAchados((res.files as ArquivoDrive[]) ?? []);
      // A action ja vinculou o que faltava; refletimos no estado local.
      setSel((atual) =>
        atual
          ? {
              ...atual,
              transcricao: res.transcricao ?? atual.transcricao,
              gravacao: res.gravacao ?? atual.gravacao,
            }
          : atual
      );
      router.refresh();
    });
  }

  // Roteia pelo tipo: video vira gravacao, o resto vira transcricao.
  function usarArquivo(a: ArquivoDrive) {
    if (!sel) return;
    startTransition(async () => {
      const res =
        a.tipo === "gravacao"
          ? await vincularGravacao(sel.id, a.webViewLink)
          : await vincularTranscricao(sel.id, a.webViewLink);
      if (res?.error) alert(res.error);
      else {
        setSel(
          a.tipo === "gravacao"
            ? { ...sel, gravacao: a.webViewLink }
            : { ...sel, transcricao: a.webViewLink }
        );
        router.refresh();
      }
    });
  }

  function removerGravacao() {
    if (!sel || !confirm("Remover a gravação desta reunião?")) return;
    startTransition(async () => {
      const res = await vincularGravacao(sel.id, "");
      if (res?.error) alert(res.error);
      else {
        setSel({ ...sel, gravacao: null });
        router.refresh();
      }
    });
  }

  async function copiarResumo() {
    if (!resumo) return;
    try {
      await navigator.clipboard.writeText(resumo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      alert("Não foi possível copiar.");
    }
  }

  function novaReuniao() {
    if (!sel || !novaDate || !novaTime) return;
    startTransition(async () => {
      const res = await scheduleMeeting(sel.leads.id, {
        startLocal: `${novaDate}T${novaTime}`,
        durationMin: 60,
        attendeeEmail: sel.leads.email ?? undefined,
      });
      if (res?.error) alert(res.error);
      else {
        setSel(null);
        router.refresh();
      }
    });
  }

  function reagendar() {
    if (!sel || !rescDate || !rescTime) return;
    const startLocal = `${rescDate}T${rescTime}`;
    startTransition(async () => {
      const res = await rescheduleMeeting(sel.id, startLocal, 60);
      if (res?.error) alert(res.error);
      else {
        setSel(null);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-white">Reuniões</h1>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { v: cnt.agendada, l: "Agendadas", c: "text-brand" },
          { v: cnt.realizada, l: "Realizadas", c: "text-emerald-400" },
          { v: cnt.furada, l: "Furadas", c: "text-amber-400" },
          {
            v: taxa != null ? `${taxa}%` : "—",
            l: "Comparecimento",
            c: "text-white",
          },
        ].map((k) => (
          <div key={k.l} className="sd-card p-3 text-center">
            <div className={`text-2xl font-bold ${k.c}`}>{k.v}</div>
            <div className="text-xs text-slate-400">{k.l}</div>
          </div>
        ))}
      </div>

      {/* Navegacao */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={prev}
            className="rounded-lg px-3 py-1.5 text-lg text-slate-300 hover:bg-white/5"
          >
            ‹
          </button>
          <h2 className="min-w-[180px] text-center text-lg font-semibold text-white">
            {MONTHS[vMonth]} {vYear}
          </h2>
          <button
            onClick={next}
            className="rounded-lg px-3 py-1.5 text-lg text-slate-300 hover:bg-white/5"
          >
            ›
          </button>
        </div>
        <button
          onClick={goToday}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
        >
          Hoje
        </button>
      </div>

      {/* Calendario */}
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          <div className="mb-1 grid grid-cols-7">
            {WDAYS.map((d, i) => (
              <div
                key={d}
                className={`py-2 text-center text-xs font-semibold ${
                  i >= 5 ? "text-slate-600" : "text-slate-400"
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.map((day) => {
              const dm = byDate[day.key] ?? [];
              const isToday = day.key === today;
              const wkend =
                day.date.getDay() === 0 || day.date.getDay() === 6;

              return (
                <div
                  key={day.key}
                  className={`min-h-[90px] rounded-lg border p-1.5 ${
                    isToday
                      ? "border-brand/40 bg-brand/5"
                      : day.cur
                        ? "border-white/5 bg-navy-mid"
                        : "border-transparent bg-navy/30"
                  } ${wkend && !isToday ? "opacity-40" : ""}`}
                >
                  <div
                    className={`mb-1 text-xs font-medium ${
                      isToday
                        ? "text-brand"
                        : day.cur
                          ? "text-slate-300"
                          : "text-slate-600"
                    }`}
                  >
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dm.map((m) => {
                      const sc = STATUS_CFG[m.status] ?? STATUS_CFG.agendada;
                      const n = ordem[m.id] ?? 1;
                      const follow = n > 1;
                      return (
                        <button
                          key={m.id}
                          onClick={() => openMeeting(m)}
                          title={
                            follow
                              ? `${ordinalBR(n)} com ${m.leads.nome}`
                              : m.leads.nome
                          }
                          className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white transition hover:brightness-125 ${
                            follow ? sc.pillFollow : sc.pill
                          }`}
                        >
                          {follow && (
                            <span className="mr-1 font-bold opacity-90">
                              {n}ª
                            </span>
                          )}
                          {fmtTime(m.starts_at)} {m.leads.nome.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="mt-3 flex flex-wrap gap-3">
        {(
          ["agendada", "realizada", "furada", "cancelada"] as MeetingStatus[]
        ).map((s) => (
          <div
            key={s}
            className="flex items-center gap-1.5 text-xs text-slate-400"
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_CFG[s].pill}`}
            />
            {STATUS_CFG[s].label}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-800" />
          Tom escuro = 2ª reunião em diante
        </div>
      </div>

      {/* Modal detalhe */}
      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSel(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-navy-mid p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-white">
                  {sel.titulo ?? sel.leads.nome}
                </h3>
                <p className="text-sm text-slate-400">
                  {new Date(sel.starts_at).toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  {fmtTime(sel.starts_at)} – {fmtTime(sel.ends_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {ordem[sel.id] > 1 && (
                  <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-300">
                    {ordinalBR(ordem[sel.id])}
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CFG[sel.status]?.bg} ${STATUS_CFG[sel.status]?.text}`}
                >
                  {STATUS_CFG[sel.status]?.label}
                </span>
                <button
                  onClick={() => setSel(null)}
                  className="text-lg leading-none text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Dados do lead */}
            <div className="mb-4 rounded-lg border border-white/5 bg-navy p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Dados do Lead
              </h4>
              <div className="space-y-1.5 text-sm">
                <Row label="Nome">
                  <Link
                    href={`/leads/${sel.leads.id}`}
                    className="text-brand hover:underline"
                    onClick={() => setSel(null)}
                  >
                    {sel.leads.nome}
                  </Link>
                </Row>
                {sel.leads.email && (
                  <Row label="Email">{sel.leads.email}</Row>
                )}
                {sel.leads.whatsapp && (
                  <Row label="WhatsApp">
                    <a
                      href={waLink(sel.leads.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-emerald-400 hover:underline"
                      title="Abrir conversa no WhatsApp"
                    >
                      {sel.leads.whatsapp}
                      <span aria-hidden>↗</span>
                    </a>
                  </Row>
                )}
                {sel.leads.origem && (
                  <Row label="Origem">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ORIGEM_CFG[sel.leads.origem] ?? ORIGEM_CFG.outro
                      }`}
                    >
                      {ORIGIN_LABELS[sel.leads.origem as LeadOrigin] ??
                        sel.leads.origem}
                    </span>
                  </Row>
                )}
              </div>
            </div>

            {/* Link Meet */}
            {sel.meet_link && (
              <div className="mb-4">
                <a
                  href={sel.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark"
                >
                  Entrar no Google Meet
                </a>
              </div>
            )}

            {/* Anotacoes SDR */}
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <label className="sd-label">Anotações SDR</label>
                <button
                  type="button"
                  onClick={copiarResumo}
                  disabled={!resumo}
                  className="mb-1 text-xs text-slate-400 hover:text-brand disabled:opacity-40"
                >
                  {copiado ? "Copiado ✓" : "Copiar"}
                </button>
              </div>
              <textarea
                value={resumo}
                onChange={(e) => setResumo(e.target.value)}
                rows={6}
                placeholder="Como foi a reunião, pontos discutidos, próximos passos..."
                className="sd-input px-2 py-1.5"
              />
            </div>

            {/* Transcricao - file upload */}
            <div className="mb-5">
              <label className="sd-label">Transcrição</label>
              {sel.transcricao ? (
                <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-navy px-3 py-2.5">
                  <a
                    href={sel.transcricao}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-sm text-brand hover:underline"
                  >
                    {fileNameFromUrl(sel.transcricao)}
                  </a>
                  <a
                    href={downloadUrl(sel.transcricao)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-slate-300 hover:text-brand"
                    title="Baixar em PDF"
                  >
                    Baixar
                  </a>
                  <button
                    onClick={removeFile}
                    disabled={pending}
                    className="shrink-0 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Remover
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400 transition hover:border-brand/40 hover:text-slate-200">
                  {pending
                    ? "Enviando..."
                    : "Clique para enviar arquivo (PDF, DOC, audio...)"}
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFile}
                    accept=".pdf,.doc,.docx,.txt,.mp3,.wav,.m4a,.ogg,.mp4,.webm"
                    disabled={pending}
                  />
                </label>
              )}

              {(!sel.transcricao || !sel.gravacao) && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={buscarNoDrive}
                    disabled={pending || buscando}
                    className="text-xs text-slate-400 hover:text-brand disabled:opacity-50"
                  >
                    {buscando
                      ? "Procurando no Drive..."
                      : "Buscar transcrição do Meet no Google Drive"}
                  </button>

                  {achados?.length === 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Nada encontrado. A transcrição só existe se alguém a
                      ativou durante a reunião, e o Google leva alguns minutos
                      para gerar o arquivo.
                    </p>
                  )}

                  {achados && achados.length > 0 && (
                    <>
                      <p className="mt-1.5 text-xs text-slate-500">
                        Encontrados no Drive. Transcrição e gravação já foram
                        vinculadas; clique em Usar para trocar por outro.
                      </p>
                    <ul className="mt-1 space-y-1">
                      {achados.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center gap-2 rounded-lg border border-white/5 bg-navy px-2.5 py-2"
                        >
                          <span className="shrink-0 text-xs text-slate-500">
                            {a.tipo === "transcricao"
                              ? "📄"
                              : a.tipo === "gravacao"
                                ? "🎥"
                                : "📎"}
                          </span>
                          <span className="flex-1 truncate text-xs text-slate-300">
                            {a.name}
                          </span>
                          <button
                            onClick={() => usarArquivo(a)}
                            disabled={pending}
                            className="shrink-0 text-xs text-brand hover:underline disabled:opacity-50"
                          >
                            Usar
                          </button>
                        </li>
                      ))}
                    </ul>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Status */}
            <div className="mb-4">
              <label className="sd-label">Status</label>
              <div className="flex flex-wrap gap-2">
                {(["agendada", "realizada", "furada", "cancelada"] as const).map(
                  (st) => {
                    const c = STATUS_CFG[st];
                    const active = sel.status === st;
                    return (
                      <button
                        key={st}
                        disabled={pending || active}
                        onClick={() => {
                          if (st === "agendada") return;
                          marcar(st);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                          active
                            ? `${c.bg} ${c.text} ring-1 ring-current`
                            : `${c.bg} ${c.text} opacity-50 hover:opacity-100`
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Reagendar */}
            <div className="mb-5">
              {!showReschedule ? (
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => {
                      setShowReschedule(true);
                      setShowNova(false);
                    }}
                    className="text-sm text-slate-400 hover:text-brand"
                  >
                    Reagendar esta reunião
                  </button>
                  <button
                    onClick={() => setShowNova((v) => !v)}
                    className="text-sm text-slate-400 hover:text-brand"
                  >
                    + Nova reunião com {primeiroNome(sel.leads.nome)}
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-white/5 bg-navy p-3">
                  <label className="sd-label">Nova data e horário</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={rescDate}
                      onChange={(e) => setRescDate(e.target.value)}
                      className="sd-input flex-1"
                    />
                    <select
                      value={rescTime}
                      onChange={(e) => setRescTime(e.target.value)}
                      className="sd-input w-28"
                    >
                      <option value="">Horário</option>
                      <optgroup label="Manhã">
                        {genSlots(9, 12).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Tarde">
                        {genSlots(14, 18).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={reagendar}
                      disabled={pending || !rescDate || !rescTime}
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-60"
                    >
                      {pending ? "Reagendando..." : "Confirmar"}
                    </button>
                    <button
                      onClick={() => setShowReschedule(false)}
                      className="text-sm text-slate-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Gravacao da reuniao */}
            {sel.gravacao && (
              <div className="mb-5">
                <div className="flex items-center justify-between">
                  <label className="sd-label">Gravação</label>
                  <button
                    type="button"
                    onClick={removerGravacao}
                    disabled={pending}
                    className="mb-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Remover
                  </button>
                </div>
                {drivePreview(sel.gravacao) ? (
                  <div className="overflow-hidden rounded-lg border border-white/5 bg-black">
                    <iframe
                      src={drivePreview(sel.gravacao)!}
                      allow="autoplay; fullscreen"
                      allowFullScreen
                      className="aspect-video w-full"
                      title="Gravação da reunião"
                    />
                  </div>
                ) : (
                  <a
                    href={sel.gravacao}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-white/5 bg-navy px-3 py-2.5 text-sm text-brand hover:underline"
                  >
                    Abrir gravação no Drive
                  </a>
                )}
                <p className="mt-1.5 text-xs text-slate-500">
                  O player usa o Drive: quem assiste precisa estar logado numa
                  conta Google com acesso ao arquivo.
                </p>
              </div>
            )}

            {/* Nova reuniao com o mesmo lead */}
            {showNova && !showReschedule && (
              <div className="mb-5 rounded-lg border border-violet-500/20 bg-navy p-3">
                <label className="sd-label">
                  {ordinalBR((ordem[sel.id] ?? 1) + 1)} com{" "}
                  {primeiroNome(sel.leads.nome)}
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={novaDate}
                    onChange={(e) => setNovaDate(e.target.value)}
                    className="sd-input flex-1"
                  />
                  <select
                    value={novaTime}
                    onChange={(e) => setNovaTime(e.target.value)}
                    className="sd-input w-28"
                  >
                    <option value="">Horário</option>
                    <optgroup label="Manhã">
                      {genSlots(9, 12).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Tarde">
                      {genSlots(14, 18).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={novaReuniao}
                    disabled={pending || !novaDate || !novaTime}
                    className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-60"
                  >
                    {pending ? "Agendando..." : "Agendar"}
                  </button>
                  <button
                    onClick={() => setShowNova(false)}
                    className="text-sm text-slate-400 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Cria um evento novo no Google Meet e mantém a reunião atual
                  no histórico.
                </p>
              </div>
            )}

            {/* Salvar anotacoes */}
            <div>
              <button
                onClick={salvar}
                disabled={pending}
                className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-navy hover:bg-brand-dark disabled:opacity-60"
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">{children}</span>
    </div>
  );
}
