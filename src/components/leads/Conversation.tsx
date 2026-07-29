"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendLeadMessage } from "@/app/(app)/leads/actions";
import { createClient } from "@/lib/supabase/client";
import type { LeadMessage } from "@/types/database";

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

  return (
    <div className="flex h-[70vh] flex-col rounded-xl border border-slate-800 bg-slate-900">
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
                <div>{m.body}</div>
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            hasWhatsapp ? "Responder..." : "Lead sem WhatsApp cadastrado"
          }
          disabled={!hasWhatsapp || pending}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!hasWhatsapp || pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  );
}
