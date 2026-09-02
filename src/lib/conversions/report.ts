// Devolve estagios do funil para as plataformas de anuncio. SERVER-ONLY.
//
// Um lead traz o identificador do canal por onde entrou: `gclid` no Google
// Ads, `meta_lead_id` no Lead Ads da Meta. Este modulo decide para onde
// enviar e cuida do registro; cada canal so implementa o envio.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarConversaoGoogle,
  googleConfigurado,
  type TipoIdentificador,
} from "@/lib/google/ads";
import { enviarEventoMeta, metaConfigured } from "@/lib/meta/conversions";

export type ConversionType = "qualificado" | "fechado";
type Canal = "google" | "meta";

const VALOR_QUALIFICADO = Number(
  process.env.GOOGLE_ADS_VALOR_QUALIFICADO ?? "200"
);
const VALOR_FECHADO_PADRAO = Number(
  process.env.GOOGLE_ADS_VALOR_FECHADO_PADRAO ?? "0"
);

interface Lead {
  id: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  meta_lead_id: string | null;
  ctwa_clid: string | null;
  valor_fechado: number | null;
  ja_cliente: boolean;
}

// Trafego de iOS chega com gbraid ou wbraid no lugar do gclid. Qualquer
// um dos tres atribui o clique; o Data Manager so precisa saber em qual
// campo do adIdentifiers colocar.
function identificadorGoogle(
  lead: Lead
): { valor: string; tipo: TipoIdentificador } | null {
  if (lead.gclid) return { valor: lead.gclid, tipo: "gclid" };
  if (lead.gbraid) return { valor: lead.gbraid, tipo: "gbraid" };
  if (lead.wbraid) return { valor: lead.wbraid, tipo: "wbraid" };
  return null;
}

function valorDe(lead: Lead, tipo: ConversionType) {
  return tipo === "fechado"
    ? Number(lead.valor_fechado ?? VALOR_FECHADO_PADRAO)
    : VALOR_QUALIFICADO;
}

/**
 * Registra a intencao e envia, se houver o que enviar.
 *
 * O insert e a trava de idempotencia: a unique (lead_id, tipo, canal) faz o
 * segundo insert falhar, e nada e reenviado. Isso importa porque as duas
 * plataformas somam cada envio - repetir infla a campanha.
 */
async function registrarEEnviar(args: {
  admin: SupabaseClient;
  lead: Lead;
  tipo: ConversionType;
  canal: Canal;
  identificador: string | null;
  idTipo?: string | null;
  statusSemIdentificador: string;
  enviar: (rowId: string, valor: number, quando: Date) => Promise<{
    ok: boolean;
    error?: string;
    requestId?: string;
  }>;
}): Promise<void> {
  const { admin, lead, tipo, canal, identificador } = args;

  const agora = new Date();
  const valor = valorDe(lead, tipo);

  // Fechamento sem valor fica em espera em vez de subir zerado: a unique
  // impede corrigir depois, entao um zero enviado agora seria permanente.
  const semValor = tipo === "fechado" && !(valor > 0);

  const { data: row, error: insErr } = await admin
    .from("ads_conversions")
    .insert({
      lead_id: lead.id,
      tipo,
      canal,
      gclid: identificador,
      id_tipo: args.idTipo ?? null,
      valor,
      conversion_at: agora.toISOString(),
      status: !identificador
        ? args.statusSemIdentificador
        : semValor
          ? "aguardando_valor"
          : "pendente",
    })
    .select("id")
    .single();

  if (insErr || !row) return; // ja enviado antes
  if (!identificador || semValor) return;

  const r = await args.enviar(row.id, valor, agora);

  await admin
    .from("ads_conversions")
    .update(
      r.ok
        ? {
            status: "enviado",
            uploaded_at: new Date().toISOString(),
            request_id: r.requestId ?? null,
          }
        : { status: "erro", erro: r.error }
    )
    .eq("id", row.id);

  if (!r.ok) console.error(`[conv:${canal}] falhou:`, r.error);
}

/** Nunca lanca - falha aqui nao pode quebrar a acao do CRM. */
export async function reportConversion(
  leadId: string,
  tipo: ConversionType
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select(
        "id, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, valor_fechado, ja_cliente"
      )
      .eq("id", leadId)
      .single();
    if (!data) return;
    const lead = data as Lead;

    // Cliente existente que voltou pelo numero do SDR nao e aquisicao.
    // Enviar como conversao ensinaria as plataformas a buscar mais gente que
    // ja e cliente - o oposto do que a integracao existe para fazer.
    if (lead.ja_cliente) return;

    const tarefas: Promise<void>[] = [];

    const idGoogle = identificadorGoogle(lead);

    if (googleConfigurado()) {
      tarefas.push(
        registrarEEnviar({
          admin,
          lead,
          tipo,
          canal: "google",
          identificador: idGoogle?.valor ?? null,
          idTipo: idGoogle?.tipo ?? null,
          statusSemIdentificador: "sem_gclid",
          enviar: (rowId, valor, quando) =>
            enviarConversaoGoogle({
              identificador: idGoogle!.valor,
              idTipo: idGoogle!.tipo,
              tipo,
              eventTimestamp: quando.toISOString(),
              value: valor,
              currency: "BRL",
              transactionId: rowId,
            }),
        })
      );
    }

    if (metaConfigured()) {
      tarefas.push(
        registrarEEnviar({
          admin,
          lead,
          tipo,
          canal: "meta",
          // Formulario instantaneo tem lead_id; Click-to-WhatsApp tem
          // ctwa_clid. Qualquer um dos dois serve para atribuir.
          identificador: lead.meta_lead_id ?? lead.ctwa_clid,
          statusSemIdentificador: "sem_lead_id",
          enviar: (rowId, valor, quando) =>
            enviarEventoMeta({
              tipo,
              leadId: lead.meta_lead_id,
              ctwaClid: lead.ctwa_clid,
              eventTime: quando,
              value: valor,
              currency: "BRL",
              eventId: rowId,
            }),
        })
      );
    }

    await Promise.all(tarefas);
  } catch (e) {
    console.error("[conv] reportConversion:", e);
  }
}

/**
 * Reenvia as conversoes de um lead que ficaram sem identificador na epoca.
 *
 * Chamada quando alguem cadastra o identificador na mao pela tela de leads.
 * Atualiza a linha existente em vez de inserir: a unique (lead_id, tipo,
 * canal) faria o insert falhar e nada seria enviado.
 */
export async function reenviarPendentes(leadId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data } = await admin
      .from("leads")
      .select(
        "id, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, valor_fechado, ja_cliente"
      )
      .eq("id", leadId)
      .single();
    if (!data) return;

    const lead = data as Lead;
    if (lead.ja_cliente) return;

    const { data: linhas } = await admin
      .from("ads_conversions")
      .select("id, tipo, canal, valor, status")
      .eq("lead_id", leadId)
      .in("status", ["sem_gclid", "sem_lead_id", "erro"]);

    const idGoogle = identificadorGoogle(lead);
    const idMeta = lead.meta_lead_id ?? lead.ctwa_clid;

    for (const linha of linhas ?? []) {
      const canal = linha.canal as Canal;
      const tipo = linha.tipo as ConversionType;

      if (canal === "google" && !idGoogle) continue;
      if (canal === "meta" && !idMeta) continue;

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
              }
            : { status: "erro", erro: r.error }
        )
        .eq("id", linha.id);

      if (!r.ok) console.error(`[conv:${canal}] reenvio falhou:`, r.error);
    }
  } catch (e) {
    console.error("[conv] reenviarPendentes:", e);
  }
}

/**
 * Envia os fechamentos que ficaram parados por falta de valor. Chamada quando
 * alguem preenche valor_fechado num lead ja marcado como fechado.
 */
export async function enviarFechamentoPendente(leadId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: lead } = await admin
      .from("leads")
      .select(
        "id, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, valor_fechado, ja_cliente"
      )
      .eq("id", leadId)
      .single();

    if ((lead as Lead | null)?.ja_cliente) return;

    const valor = Number((lead as Lead | null)?.valor_fechado ?? 0);
    if (!(valor > 0)) return; // ainda sem valor: segue esperando

    const { data: rows } = await admin
      .from("ads_conversions")
      .select("id, canal, gclid, id_tipo, lead_id")
      .eq("lead_id", leadId)
      .eq("tipo", "fechado")
      .eq("status", "aguardando_valor");

    for (const row of rows ?? []) {
      const agora = new Date();
      // Anotado porque so o Google devolve requestId; a uniao dos dois
      // retornos esconderia o campo.
      const r: { ok: boolean; error?: string; requestId?: string } =
        row.canal === "meta"
          ? await enviarEventoMeta({
              tipo: "fechado",
              leadId: (lead as Lead | null)?.meta_lead_id,
              ctwaClid: (lead as Lead | null)?.ctwa_clid,
              eventTime: agora,
              value: valor,
              currency: "BRL",
              eventId: row.id as string,
            })
          : await enviarConversaoGoogle({
              identificador: row.gclid as string,
              idTipo: (row.id_tipo as TipoIdentificador) ?? "gclid",
              tipo: "fechado",
              eventTimestamp: agora.toISOString(),
              value: valor,
              currency: "BRL",
              transactionId: row.id as string,
            });

      await admin
        .from("ads_conversions")
        .update(
          r.ok
            ? {
                status: "enviado",
                valor,
                uploaded_at: agora.toISOString(),
                request_id: r.requestId ?? null,
              }
            : { status: "erro", valor, erro: r.error }
        )
        .eq("id", row.id);

      if (!r.ok) console.error(`[conv:${row.canal}] pendente falhou:`, r.error);
    }
  } catch (e) {
    console.error("[conv] enviarFechamentoPendente:", e);
  }
}
