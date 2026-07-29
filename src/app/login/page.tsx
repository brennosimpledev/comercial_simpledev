"use client";

import { useActionState } from "react";
import { login } from "./actions";

const initialState: { error?: string } = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-navy-mid p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-white">
            Comercial <span className="text-brand">SimpleDEV</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">Área interna da equipe</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="sd-label">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="sd-input"
            />
          </div>

          <div>
            <label htmlFor="password" className="sd-label">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="sd-input"
            />
          </div>

          {state?.error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {state.error}
            </p>
          )}

          <button type="submit" disabled={pending} className="sd-btn w-full">
            {pending ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
