import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  consultarStatusGoogle,
  enviarConversaoGoogle,
} from "@/lib/google/ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostico das conversoes enviadas ao Google.
//
// Existe porque "enviado" na nossa tabela so significa que o events:ingest
// aceitou a requisicao. O casamento com os cliques roda depois e pode
// rejeitar tudo - foi exatamente o que aconteceu em ago/2026, com o console
// mostrando 0% de sucesso enquanto o CRM mostrava sucesso.
//
//   GET  ?secret=...              confere os envios ainda nao diagnosticados
//   GET  ?secret=...&reenviar=ID  reenvia uma linha para capturar o requestId
//
// O reenvio e seguro: o transactionId continua sendo o id da linha, entao o
// proprio Google deduplica se por acaso a conversao tiver sido contada.

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  const query = request.nextUrl.searchParams.get("secret");
  return auth === `Bearer ${secret}` || query === secret;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const reenviar = request.nextUrl.searchParams.get("reenviar");

  if (reenviar) {
    const { data: row } = await admin
      .from("ads_conversions")
      .select("id, tipo, gclid, id_tipo, valor, conversion_at, canal")
      .eq("id", reenviar)
      .single();

    if (!row) {
      return NextResponse.json({ error: "linha nao encontrada" }, { status: 404 });
    }
    if (row.canal !== "google" || !row.gclid) {
      return NextResponse.json(
        { error: "linha nao e do Google ou nao tem gclid" },
        { status: 400 }
      );
    }

    const r = await enviarConversaoGoogle({
      identificador: row.gclid as string,
      idTipo: (row.id_tipo as "gclid" | "gbraid" | "wbraid") ?? "gclid",
      tipo: row.tipo as "qualificado" | "fechado",
      eventTimestamp: new Date(row.conversion_at as string).toISOString(),
      value: Number(row.valor ?? 0),
      currency: "BRL",
      transactionId: row.id as string,
    });

    if (r.ok) {
      await admin
        .from("ads_conversions")
        .update({
          request_id: r.requestId ?? null,
          diagnostico: null,
          diagnostico_at: null,
        })
        .eq("id", row.id);
    }

    return NextResponse.json({
      reenviado: row.id,
      aceito: r.ok,
      requestId: r.requestId ?? null,
      erro: r.error ?? null,
      proximo: "consulte de novo em ~30 min, sem o parametro reenviar",
    });
  }

  // Confere quem ja tem requestId e ainda nao fechou diagnostico. Linhas em
  // PROCESSING voltam para a fila ate darem um veredito.
  const { data: rows } = await admin
    .from("ads_conversions")
    .select("id, request_id, tipo, gclid, created_at, diagnostico")
    .eq("canal", "google")
    .eq("status", "enviado")
    .not("request_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(25);

  const pendentes = (rows ?? []).filter(
    (r) => !r.diagnostico || r.diagnostico.startsWith("PROCESSING")
  );

  const resultados = [];
  for (const row of pendentes) {
    const r = await consultarStatusGoogle(row.request_id as string);

    const texto = r.ok
      ? r.pendente && !r.resumo
        ? "PROCESSING"
        : r.resumo ?? "SEM_RESPOSTA"
      : `CONSULTA_FALHOU: ${r.error}`;

    await admin
      .from("ads_conversions")
      .update({ diagnostico: texto, diagnostico_at: new Date().toISOString() })
      .eq("id", row.id);

    resultados.push({
      id: row.id,
      tipo: row.tipo,
      enviado_em: row.created_at,
      diagnostico: texto,
    });
  }

  return NextResponse.json({
    conferidos: resultados.length,
    sem_request_id: (rows ?? []).length - pendentes.length,
    resultados,
  });
}
