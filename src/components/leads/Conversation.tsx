"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendLeadMessage,
  importLeadHistory,
  sendLeadMedia,
  sendLeadAudio,
} from "@/app/(app)/leads/actions";
import { createClient } from "@/lib/supabase/client";
import type { LeadMessage } from "@/types/database";

function MediaBlock({ message }: { message: LeadMessage }) {
  const kind = message.media_type;
  if (!kind) return null;
  const src = `/api/media/${message.id}`;

  if (kind === "image" || kind === "sticker") {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt="imagem"
        className="mb-1 max-h-64 max-w-full rounded-lg"
        loading="lazy"
      />
    );
  }
  if (kind === "audio") {
    return <audio controls src={src} className="mb-1 w-56" />;
  }
  if (kind === "video") {
    return (
      <video controls src={src} className="mb-1 max-h-64 max-w-full rounded-lg" />
    );
  }
  // document / outros
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1 text-xs underline"
    >
      📎 Baixar arquivo
    </a>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function Conversation({
  leadId,
  messages: initialMessages,
  hasWhatsapp,
}: {
  leadId: string;
  messages: LeadMessage[];
  hasWhatsapp: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState<LeadMessage[]>(initialMessages);
  const endRef = useRef<HTMLDivElement>(null);

  // Sincroniza quando o servidor traz novas mensagens (ex.: apos enviar).
  useEffect(() => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of initialMessages) map.set(m.id, m);
      return Array.from(map.values()).sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, [initialMessages]);

  // Realtime (instantaneo) + poll de fallback (garante a atualizacao).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const addMsg = (m: LeadMessage) =>
      setMessages((prev) =>
        prev.some((x) => x.id === m.id)
          ? prev
          : [...prev, m].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime()
            )
      );

    const channel = supabase.channel(`lead-messages-${leadId}`).on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "lead_messages",
        filter: `lead_id=eq.${leadId}`,
      },
      (payload) => addMsg(payload.new as LeadMessage)
    );

    // Autentica o realtime com o token do usuario (RLS = authenticated).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });

    // Poll confiavel: busca as mensagens no nosso endpoint (autenticado por
    // cookie no servidor) a cada 4s. Independe de auth do Supabase no cliente.
    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/leads/${leadId}/messages`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { messages: LeadMessage[] };
        if (!cancelled) json.messages.forEach(addMsg);
      } catch {
        /* ignora falha de rede pontual */
      }
    };
    const interval = setInterval(poll, 4000);
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [leadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function send() {
    const body = text.trim();
    if (!body) return;
    startTransition(async () => {
      const res = await sendLeadMessage(leadId, body);
      if (res?.error) alert(res.error);
      else {
        setText("");
        router.refresh();
      }
    });
  }

  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function handleFile(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      alert("Arquivo muito grande (máx. 4MB).");
      return;
    }
    setBusy(true);
    try {
      const base64 = await blobToBase64(file);
      const mediatype = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "document";
      const res = await sendLeadMedia(leadId, {
        mediatype,
        base64,
        mimetype: file.type || "application/octet-stream",
        fileName: file.name,
      });
      if (res?.error) alert(res.error);
      else router.refresh();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: chunksRef.current[0]?.type || "audio/webm",
        });
        if (blob.size === 0) return;
        setBusy(true);
        try {
          const base64 = await blobToBase64(blob);
          const res = await sendLeadAudio(leadId, base64);
          if (res?.error) alert(res.error);
          else router.refresh();
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("Não foi possível acessar o microfone.");
    }
  }

  const [importing, setImporting] = useState(false);
  function importHistory() {
    setImporting(true);
    startTransition(async () => {
      const res = await importLeadHistory(leadId);
      setImporting(false);
      if (res?.error) alert(res.error);
      else {
        if (res.imported === 0) alert("Nenhuma mensagem antiga encontrada.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-xl border border-white/10 bg-navy-mid">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <span className="text-xs text-slate-400">Conversa</span>
        <button
          onClick={importHistory}
          disabled={importing || pending || !hasWhatsapp}
          className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {importing ? "Carregando..." : "Carregar histórico"}
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-500">
            Sem mensagens ainda.
          </p>
        )}
        {messages.map((m) => {
          const out = m.direction === "outbound";
          return (
            <div
              key={m.id}
              className={"flex " + (out ? "justify-end" : "justify-start")}
            >
              <div
                className={
                  "max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm " +
                  (out
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-700 text-slate-100")
                }
              >
                <MediaBlock message={m} />
                {m.body && <div>{m.body}</div>}
                <div
                  className={
                    "mt-1 text-right text-[10px] " +
                    (out ? "text-emerald-100" : "text-slate-400")
                  }
                >
                  {fmt(m.created_at)}
                  {out && m.status === "failed" && " · falhou"}
                  {out && m.status === "sent" && " · enviado"}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-slate-800 p-3">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!hasWhatsapp || busy || pending}
          title="Anexar foto ou arquivo"
          className="rounded-lg border border-slate-700 px-2.5 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          📎
        </button>
        <button
          onClick={toggleRecord}
          disabled={!hasWhatsapp || busy || pending}
          title={recording ? "Parar e enviar" : "Gravar áudio"}
          className={
            "rounded-lg border px-2.5 py-2 disabled:opacity-50 " +
            (recording
              ? "border-red-500 bg-red-500/20 text-red-400 animate-pulse"
              : "border-slate-700 text-slate-300 hover:bg-slate-800")
          }
        >
          {recording ? "⏺" : "🎤"}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            !hasWhatsapp
              ? "Lead sem WhatsApp cadastrado"
              : recording
                ? "Gravando áudio..."
                : busy
                  ? "Enviando..."
                  : "Responder..."
          }
          disabled={!hasWhatsapp || pending || busy || recording}
          className="flex-1 rounded-lg border border-white/10 bg-[#0b2a49] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!hasWhatsapp || pending || busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  );
}
