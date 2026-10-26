"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { horaBR } from "@/lib/agenda";

// Bloqueios de agenda: periodos em que ninguem marca reuniao.

export type Bloqueio = {
  id: string;
  inicio: string;
  fim: string;
  motivo: string | null;
};

export async function listarBloqueios(desdeISO: string, ateISO: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_bloqueios")
    .select("id, inicio, fim, motivo")
    .lt("inicio", ateISO)
    .gt("fim", desdeISO)
    .order("inicio", { ascending: true });
  if (error) return { bloqueios: [] as Bloqueio[], erro: error.message };
  return { bloqueios: (data ?? []) as Bloqueio[] };
}

export async function criarBloqueio(dados: {
  data: string; // AAAA-MM-DD
  periodo: "manha" | "tarde" | "dia" | "personalizado";
  inicioHora?: string; // HH:MM, no personalizado
  fimHora?: string;
  motivo?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };
  if (!dados.data) return { error: "Escolha a data." };

  const horas = {
    manha: ["00:00", "12:00"],
    tarde: ["12:00", "23:59"],
    dia: ["00:00", "23:59"],
    personalizado: [dados.inicioHora ?? "", dados.fimHora ?? ""],
  }[dados.periodo];
  if (!horas[0] || !horas[1]) return { error: "Informe o horário de início e de fim." };

  const inicio = new Date(`${dados.data}T${horas[0]}:00-03:00`);
  const fim = new Date(`${dados.data}T${horas[1]}:00-03:00`);
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || fim <= inicio) {
    return { error: "Horário inválido: o fim precisa ser depois do início." };
  }

  // Reunião já marcada no período: avisa, mas deixa o dono decidir.
  const { data: conflitos } = await supabase
    .from("meetings")
    .select("starts_at, leads(nome)")
    .eq("status", "agendada")
    .lt("starts_at", fim.toISOString())
    .gt("ends_at", inicio.toISOString());

  const { error } = await supabase.from("agenda_bloqueios").insert({
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    motivo: dados.motivo?.trim() || null,
    created_by: user.id,
  });
  if (error) {
    console.error("[criarBloqueio]", error);
    return { error: "Não foi possível bloquear. A migration 0017 já foi aplicada?" };
  }

  revalidatePath("/reunioes");
  return {
    ok: true,
    aviso:
      conflitos && conflitos.length > 0
        ? `Atenção: já existe reunião marcada nesse período (${conflitos
            .map((c) => `${(c.leads as unknown as { nome?: string })?.nome ?? "lead"} às ${horaBR(c.starts_at as string)}`)
            .join(", ")}). Ela continua marcada; remarque se precisar.`
        : null,
  };
}

export async function removerBloqueio(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };
  const { error } = await supabase.from("agenda_bloqueios").delete().eq("id", id);
  if (error) return { error: "Não foi possível remover o bloqueio." };
  revalidatePath("/reunioes");
  return { ok: true };
}
