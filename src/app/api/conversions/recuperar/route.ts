import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarConversaoGoogle,
  googleConfigurado,
  type TipoIdentificador,
} from "@/lib/google/ads";
import { enviarEventoMeta, metaConfigured } from "@/lib/meta/conversions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reenvio das conversoes que ficaram sem identificador na epoca.
//
// Um lead pode ganhar o identificador depois: o webhook da Meta agora
// completa o lead existente em vez de duplicar, e da para copiar o
// meta_lead_id de um lead gemeo. Quando isso acontece, a linha em
// `sem_lead_id` / `sem_gclid` passa a ter o que enviar.
//
// Requalificar pela interface NAO resolve: a unique (lead_id, tipo, canal)
// faz o insert falhar e nada e enviado. Por isso esta rota ATUALIZA a linha
// existente em vez de criar outra.
//
//   GET ?secret=...            lista o que da para recuperar (nao envia)
//   GET ?secret=...&enviar=1   envia e atualiza as linhas
//
// O event_id / transactionId continua sendo o id da linha, entao as duas
// plataformas deduplicam do lado delas se algo ja tiver sido contado.

interface Lead {
  id: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  meta_lead_id: string | null;
  ctwa_clid: string | null;
  ja_cliente: boolean;
}

function identificadorGoogle(
  lead: Lead
): { valor: string; tipo: TipoIdentificador } | null {
  if (lead.gclid) return { valor: lead.gclid, tipo: "gclid" };
  if (lead.gbraid) return { valor: lead.gbraid, tipo: "gbraid" };
  if (lead.wbraid) return { valor: lead.wbraid, tipo: "wbraid" };
  return null;
}

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

  const enviar = request.nextUrl.searchParams.get("enviar") === "1";
  const admin = createAdminClient();

  const { data: linhas } = await admin
    .from("ads_conversions")
    .select("id, lead_id, tipo, canal, valor, status")
    .in("status", ["sem_gclid", "sem_lead_id"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (!linhas?.length) {
    return NextResponse.json({ recuperaveis: 0, resultados: [] });
  }

  const ids = [...new Set(linhas.map((l) => l.lead_id as string))];
  const { data: leadsData } = await admin
    .from("leads")
    .select("id, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, ja_cliente")
    .in("id", ids);

  const porId = new Map<string, Lead>(
    (leadsData ?? []).map((l) => [l.id as string, l as Lead])
  );

  const resultados: Array<Record<string, unknown>> = [];

  for (const linha of linhas) {
    const lead = porId.get(linha.lead_id as string);
    if (!lead || lead.ja_cliente) continue;

    const canal = linha.canal as "google" | "meta";
    const tipo = linha.tipo as "qualificado" | "fechado";

    const idGoogle = canal === "google" ? identificadorGoogle(lead) : null;
    const idMeta =
      canal === "meta" ? lead.meta_lead_id ?? lead.ctwa_clid : null;

    // Nada mudou para esta linha: segue sem identificador.
    if (canal === "google" && !idGoogle) continue;
    if (canal === "meta" && !idMeta) continue;

    const item: Record<string, unknown> = {
      conversao: linha.id,
      lead: lead.id,
      canal,
      tipo,
      identificador: canal === "google" ? idGoogle!.tipo : "meta_lead_id",
    };

    if (!enviar) {
      resultados.push({ ...item, acao: "seria enviada" });
      continue;
    }

    const agora = new Date();
    const valor = Number(linha.valor ?? 0);

    const r =
      canal === "meta"
        ? await enviarEventoMeta({
            tipo,
            leadId: lead.meta_lead_id,
            ctwaClid: lead.ctwa_clid,
            eventTime: agora,
            value: valor,
            currency: "BRL",
            eventId: linha.id as string,
          })
        : await enviarConversaoGoogle({
            identificador: idGoogle!.valor,
            idTipo: idGoogle!.tipo,
            tipo,
            eventTimestamp: agora.toISOString(),
            value: valor,
            currency: "BRL",
            transactionId: linha.id as string,
          });

    await admin
      .from("ads_conversions")
      .update(
        r.ok
          ? {
              status: "enviado",
              gclid: canal === "google" ? idGoogle!.valor : idMeta,
              id_tipo: canal === "google" ? idGoogle!.tipo : null,
              uploaded_at: agora.toISOString(),
              erro: null,
              request_id:
                (r as { requestId?: string }).requestId ?? null,
            }
          : { status: "erro", erro: r.error }
      )
      .eq("id", linha.id);

    resultados.push({ ...item, enviada: r.ok, erro: r.error ?? null });
  }

  return NextResponse.json({
    modo: enviar ? "envio" : "simulacao",
    google_configurado: googleConfigurado(),
    meta_configurada: metaConfigured(),
    recuperaveis: resultados.length,
    resultados,
  });
}
