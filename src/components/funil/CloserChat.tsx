"use client";

import { useEffect, useRef, useState } from "react";
import {
  enviarAudioDoCloser,
  enviarMensagemCloser,
  enviarMidiaDoCloser,
  importarHistoricoCloser,
} from "@/app/(app)/funil/closer";
import { mensagensProntas } from "@/components/funil/mensagensProntas";

// Chat do lead no WhatsApp do closer. Igual ao do SDR na ficha do lead, mas
// lendo e enviando pela instancia do closer.

type Mensagem = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  media_type: string | null;
  sent_at: string;
};

function Midia({ m }: { m: Mensagem }) {
  const src = `/api/media/closer/${m.id}`;
  if (m.media_type === "image" || m.media_type === "sticker") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="imagem" className="mb-1 max-h-60 max-w-full rounded-lg" loading="lazy" />;
  }
  if (m.media_type === "audio") return <audio controls src={src} className="mb-1 w-52" preload="none" />;
  if (m.media_type === "video") return <video controls src={src} className="mb-1 max-h-60 max-w-full rounded-lg" preload="none" />;
  if (m.media_type === "document") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1 text-xs underline">
        📎 Baixar arquivo
      </a>
    );
  }
  return null;
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

function paraBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function CloserChat({ leadId, nome, temWhatsapp }: { leadId: string; nome: string; temWhatsapp: boolean }) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const buscarRef = useRef<() => Promise<void>>(async () => {});

  // Poll a cada 4s enquanto o painel esta aberto e a aba visivel.
  useEffect(() => {
    let vivo = true;
    setMensagens([]);
    setCarregou(false);
    setErro(null);
    const buscar = async () => {
      if (!vivo || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/leads/${leadId}/closer-messages`, { cache: "no-store" });
        const json = (await res.json()) as { messages?: Mensagem[]; error?: string };
        if (!vivo) return;
        if (!res.ok) {
          if (res.status === 503 && json.error) setErro(json.error);
          return;
        }
        setMensagens((antes) => {
          const nova = json.messages ?? [];
          if (antes.length === nova.length && antes.at(-1)?.id === nova.at(-1)?.id) return antes;
          return nova;
        });
        setCarregou(true);
      } catch {
        /* falha de rede pontual */
      }
    };
    buscarRef.current = buscar;
    buscar();
    const t = setInterval(buscar, 4000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [leadId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  async function executar(fn: () => Promise<{ error?: string; aviso?: string }>) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fn();
      if (r.error) {
        setErro(r.error);
        return false;
      }
      if (r.aviso) setAviso(r.aviso);
      await buscarRef.current();
      return true;
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    const body = texto.trim();
    if (!body) return;
    if (await executar(() => enviarMensagemCloser(leadId, body))) setTexto("");
  }

  async function anexar(f: File) {
    if (f.size > 4 * 1024 * 1024) return setErro("Arquivo muito grande (máx. 4MB).");
    const base64 = await paraBase64(f);
    const mediatype = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "document";
    await executar(() =>
      enviarMidiaDoCloser(leadId, { mediatype, base64, mimetype: f.type || "application/octet-stream", fileName: f.name })
    );
    if (arquivoRef.current) arquivoRef.current.value = "";
  }

  async function gravar() {
    if (gravando) return gravadorRef.current?.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      pedacosRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && pedacosRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const blob = new Blob(pedacosRef.current, { type: pedacosRef.current[0]?.type || "audio/webm" });
        if (blob.size === 0) return;
        const base64 = await paraBase64(blob);
        await executar(() => enviarAudioDoCloser(leadId, base64));
      };
      gravadorRef.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      setErro("Não foi possível acessar o microfone.");
    }
  }

  async function importar() {
    setImportando(true);
    setAviso(null);
    setErro(null);
    try {
      const r = await importarHistoricoCloser(leadId);
      if ("error" in r && r.error) return setErro(r.error);
      const n = "importadas" in r ? r.importadas : 0;
      setAviso(n === 0 ? "Nada novo no histórico do seu WhatsApp." : `${n} mensagens trazidas do seu WhatsApp.`);
      await buscarRef.current();
    } finally {
      setImportando(false);
    }
  }

  const bloqueado = !temWhatsapp || ocupado || gravando;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f && temWhatsapp && !ocupado) anexar(f);
      }}
      className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-white/10 bg-navy-mid"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold text-slate-300">WhatsApp do closer</span>
        <button
          onClick={importar}
          disabled={importando || !temWhatsapp}
          title="Busca no seu WhatsApp as mensagens que ainda não estão aqui"
          className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {importando ? "Buscando…" : "Carregar histórico"}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {carregou && mensagens.length === 0 && (
          <p className="mt-8 text-center text-xs text-slate-500">
            Nenhuma mensagem com esse lead no seu WhatsApp ainda.
            <br />
            Use “Carregar histórico” para trazer conversas antigas.
          </p>
        )}
        {mensagens.map((m) => {
          const saiu = m.direction === "outbound";
          return (
            <div key={m.id} className={"flex " + (saiu ? "justify-end" : "justify-start")}>
              <div
                className={
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm " +
                  (saiu ? "bg-sky-700 text-white" : "bg-slate-700 text-slate-100")
                }
              >
                <Midia m={m} />
                {m.body && <div>{m.body}</div>}
                <div className={"mt-1 text-right text-[10px] " + (saiu ? "text-sky-100" : "text-slate-400")}>
                  {hora(m.sent_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {(erro || aviso) && (
        <p className={"border-t border-slate-800 px-3 py-2 text-xs " + (erro ? "text-red-300" : "text-slate-400")}>
          {erro ?? aviso}
        </p>
      )}

      {temWhatsapp && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-slate-800 px-2 pt-2">
          {mensagensProntas(nome).map((m) => (
            <button
              key={m.rotulo}
              type="button"
              onClick={() => {
                setTexto(m.texto);
                requestAnimationFrame(() => campoRef.current?.focus());
              }}
              title={m.texto}
              className="shrink-0 rounded-full border border-sky-500/30 px-2.5 py-1 text-[11px] text-sky-200 hover:bg-sky-500/10"
            >
              {m.rotulo}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-2">
        <input
          ref={arquivoRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) anexar(f);
          }}
        />
        <button
          onClick={() => arquivoRef.current?.click()}
          disabled={bloqueado}
          title="Anexar foto ou arquivo"
          className="rounded-lg border border-slate-700 px-2 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          📎
        </button>
        <button
          onClick={gravar}
          disabled={!temWhatsapp || ocupado}
          title={gravando ? "Parar e enviar" : "Gravar áudio"}
          className={
            "rounded-lg border px-2 py-2 disabled:opacity-50 " +
            (gravando ? "animate-pulse border-red-500 bg-red-500/20 text-red-400" : "border-slate-700 text-slate-300 hover:bg-slate-800")
          }
        >
          {gravando ? "⏺" : "🎤"}
        </button>
        <textarea
          ref={campoRef}
          rows={texto.length > 70 || texto.includes(String.fromCharCode(10)) ? 3 : 1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder={!temWhatsapp ? "Lead sem WhatsApp cadastrado" : gravando ? "Gravando áudio…" : "Mensagem pelo seu WhatsApp…"}
          disabled={bloqueado}
          className="min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-[#0b2a49] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-500 disabled:opacity-50"
        />
        <button
          onClick={enviar}
          disabled={bloqueado || !texto.trim()}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {ocupado ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
