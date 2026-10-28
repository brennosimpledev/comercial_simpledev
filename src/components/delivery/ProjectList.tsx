"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export async function api(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Falha na operação");
  return data;
}
export function ProjectList({
  leads,
}: {
  leads: { id: string; nome: string }[];
}) {
  const [projects, setProjects] = useState<
      { id: string; name: string; scope_status: string; revision: number }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [leadQuery, setLeadQuery] = useState("");
  const matchingLeads = leads.filter((lead) =>
    lead.nome
      .toLocaleLowerCase("pt-BR")
      .includes(leadQuery.trim().toLocaleLowerCase("pt-BR")),
  );
  async function load() {
    try {
      setProjects(await api("/api/delivery/projects"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-brand">
          Da proposta à entrega
        </p>
        <h1 className="text-3xl font-semibold">Projetos</h1>
        <p className="mt-2 text-slate-400">
          Escopo aprovado, execução e evidências em um só lugar.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-400/30 p-4 text-red-300"
        >
          {error}
        </p>
      )}
      <form
        className="grid gap-4 rounded-xl border border-white/10 bg-navy-mid p-5 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const p = await api("/api/delivery/projects", {
              name: f.get("name"),
              leadId: f.get("leadId"),
            });
            window.location.assign("/projetos/" + p.id);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nome do projeto
          <input
            name="name"
            className="sd-input mt-2"
            required
            minLength={3}
            maxLength={200}
          />
        </label>
        <div className="space-y-2">
          <label htmlFor="lead-search">Buscar cliente / lead</label>
          <input
            id="lead-search"
            aria-label="Buscar cliente ou lead"
            className="sd-input"
            placeholder="Digite o nome do cliente…"
            value={leadQuery}
            onChange={(e) => setLeadQuery(e.target.value)}
          />
          <label htmlFor="lead-id">Cliente / lead</label>
          <select
            id="lead-id"
            name="leadId"
            className="sd-input"
            required
            defaultValue=""
          >
            <option value="">
              Selecione entre {matchingLeads.length} resultados
            </option>
            {matchingLeads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.nome}
              </option>
            ))}
          </select>
          {!matchingLeads.length && (
            <p role="status" className="text-sm text-slate-400">
              Nenhum lead encontrado. Tente outro nome.
            </p>
          )}
        </div>
        <button disabled={busy} className="sd-btn self-end">
          {busy ? "Criando…" : "Criar projeto"}
        </button>
      </form>
      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <Link
            className="rounded-xl border border-white/10 p-5 hover:border-brand"
            key={p.id}
            href={"/projetos/" + p.id}
          >
            <h2 className="text-xl">{p.name}</h2>
            <p className="mt-2 text-slate-400">
              Versão {p.revision} ·{" "}
              {{
                draft: "Rascunho",
                review: "Em revisão",
                approved: "Aprovado",
              }[p.scope_status] ?? p.scope_status}
            </p>
          </Link>
        ))}
      </div>
      {!projects.length && !error && (
        <p className="text-slate-400">
          Crie o primeiro projeto para importar seu escopo.
        </p>
      )}
    </div>
  );
}
