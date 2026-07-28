"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendLeadMessage } from "@/app/(app)/leads/actions";
import type { LeadMessage } from "@/types/database";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Conversation({
  leadId,
  messages,
  hasWhatsapp,
}: {
  leadId: string;
  messages: LeadMessage[];
  hasWhatsapp: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

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
