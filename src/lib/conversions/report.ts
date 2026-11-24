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
import { enviarEventoMeta, metaConfigured, type ConversionType } from "@/lib/meta/conversions";
import { leadIdDoGemeo } from "@/lib/conversions/gemeo";
import { enviarEventoOpenAI, openaiConfigurado } from "@/lib/openai/conversions";

export type { ConversionType };
type Canal = "google" | "meta" | "openai";

// "lead" (entrada do lead) so existe no canal da OpenAI: na Meta e no
// Google quem conta o lead e a propria plataforma.
type TipoEnvio = ConversionType | "lead";

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

function valorDe(lead: Lead, tipo: TipoEnvio) {
  if (tipo === "fechado") return Number(lead.valor_fechado ?? VALOR_FECHADO_PADRAO);
  if (tipo === "qualificado") return VALOR_QUALIFICADO;
  // Desqualificado e etapas do meio do funil sao sinal, nao receita.
  return 0;
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
  tipo: TipoEnvio;
  canal: Canal;
  identificador: string | null;
  idTipo?: string | null;
  statusSemIdentificador: string;
  // Hora do evento, quando nao e agora (lead que entrou antes de ser enviado).
  quando?: Date;
  enviar: (rowId: string, valor: number, quando: Date) => Promise<{
    ok: boolean;
    error?: string;
    requestId?: string;
  }>;
}): Promise<void> {
  const { admin, lead, tipo, canal, identificador } = args;

  const agora = args.quando ?? new Date();
  const valor = valorDe(lead, tipo);

  // Fechamento sem valor fica em espera em vez de subir zerado: a unique
  // impede corrigir depois, entao um zero enviado agora seria permanente.
  const semValor = tipo === "fechado" && !(valor > 0);

  // O lead_id pode ser emprestado do card gemeo do formulario: se o gemeo
  // ja mandou este evento, a Meta somaria duas vezes a mesma pessoa.
  if (canal === "meta" && identificador && (await jaFoiPorOutroCard(admin, lead.id, tipo, identificador))) return;

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

async function jaFoiPorOutroCard(admin: SupabaseClient, leadId: string, tipo: TipoEnvio, identificador: string) {
  const { count } = await admin
    .from("ads_conversions")
    .select("id", { count: "exact", head: true })
    .eq("canal", "meta")
    .eq("tipo", tipo)
    .eq("gclid", identificador)
    .neq("lead_id", leadId)
    .in("status", ["enviado", "pendente", "aguardando_valor"]);
  return (count ?? 0) > 0;
}

// lead_id do formulario: o do proprio card ou o do gemeo (gemeo.ts).
async function leadIdDoFormulario(admin: SupabaseClient, lead: Lead) {
  return lead.meta_lead_id ?? (await leadIdDoGemeo(admin, lead.id));
}

/** Nunca lanca - falha aqui nao pode quebrar a acao do CRM. */
export async function reportConversion(
  leadId: string,
  // As etapas do meio do funil vao por reportarEtapa, so para a Meta.
  tipo: "qualificado" | "fechado" | "desqualificado"
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

    // O Google Ads nao tem conversao negativa: la o desqualificado seria
    // lido como mais uma conversao. So a Meta recebe este tipo.
    if (googleConfigurado() && tipo !== "desqualificado") {
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
      const metaLeadId = await leadIdDoFormulario(admin, lead);
      tarefas.push(
        registrarEEnviar({
          admin,
          lead,
          tipo,
          canal: "meta",
          // Formulario instantaneo tem lead_id; Click-to-WhatsApp tem
          // ctwa_clid. Qualquer um dos dois serve para atribuir.
          identificador: metaLeadId ?? lead.ctwa_clid,
          statusSemIdentificador: "sem_lead_id",
          enviar: (rowId, valor, quando) =>
            enviarEventoMeta({
              tipo,
              leadId: metaLeadId,
              ctwaClid: lead.ctwa_clid,
              eventTime: quando,
              value: valor,
              currency: "BRL",
              eventId: rowId,
            }),
        })
      );
    }

    tarefas.push(enviarParaOpenAI(admin, lead, tipo));

    await Promise.all(tarefas);
  } catch (e) {
    console.error("[conv] reportConversion:", e);
  }
}

// ChatGPT Ads: vai TODO lead, de qualquer origem (lib/openai/conversions.ts
// explica por que). Le os campos da OpenAI numa consulta separada: sem a
// migration 0024 as colunas nao existem, e isso nao pode derrubar Meta e
// Google.
type ExtrasOpenAI = { ip?: string | null; userAgent?: string | null; quando?: Date };

// Lead do site: formulario da LP (form_id lp_...) ou o formulario com
// caminhos. Os outros nunca passaram pela pagina.
const doSite = (formId: string | null | undefined) => /^(lp_|formulario)/.test(formId ?? "");

async function enviarParaOpenAI(
  admin: SupabaseClient,
  lead: Lead,
  tipo: TipoEnvio,
  eventIdFixo?: string,
  extras: ExtrasOpenAI = {}
) {
  if (!openaiConfigurado()) return;
  const { data: oa, error } = await admin
    .from("leads")
    .select("email, whatsapp, nome, form_id, openai_oppref, openai_obref")
    .eq("id", lead.id)
    .single();
  if (error || !oa) return;
  await registrarEEnviar({
    admin,
    lead,
    tipo,
    canal: "openai",
    quando: extras.quando,
    identificador: (oa.openai_oppref as string | null) ?? (oa.openai_obref as string | null) ?? `lead:${lead.id}`,
    statusSemIdentificador: "sem_oppref",
    enviar: (rowId, valor, quando) =>
      enviarEventoOpenAI({
        tipo,
        // A entrada do lead usa o id que a LP mandou junto com o pixel:
        // a OpenAI junta os dois e conta uma vez.
        eventId: eventIdFixo ?? rowId,
        quando,
        oppref: oa.openai_oppref as string | null,
        obref: oa.openai_obref as string | null,
        email: oa.email as string | null,
        whatsapp: oa.whatsapp as string | null,
        nome: oa.nome as string | null,
        leadId: lead.id,
        valor,
        doSite: doSite(oa.form_id as string | null),
        ip: extras.ip,
        userAgent: extras.userAgent,
      }),
  });
}

/** Entrada de um lead pelo site (chamada pelo webhook da LP e do formulario). */
export async function reportarLeadOpenAI(
  leadId: string,
  eventId?: string | null,
  extras: ExtrasOpenAI = {}
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select("id, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, valor_fechado, ja_cliente")
      .eq("id", leadId)
      .single();
    const lead = data as Lead | null;
    if (!lead || lead.ja_cliente) return;
    await enviarParaOpenAI(admin, lead, "lead", eventId ?? undefined, extras);
  } catch (e) {
    console.error("[conv] reportarLeadOpenAI:", e);
  }
}

// A API de conversoes da OpenAI so aceita evento dos ultimos 7 dias.
const JANELA_OPENAI_MS = 6.5 * 86_400_000;
// O lead do site e enviado na hora pelo webhook, com o id que o pixel usou
// (a OpenAI junta os dois). A rotina so pega quem passou disso sem envio.
const FOLGA_DO_WEBHOOK_MS = 10 * 60_000;

export type LeadParaOpenAI = { id: string; nome: string | null; origem: string; created_at: string };

/**
 * Entrada de todo lead (Meta, WhatsApp, site) que ainda nao foi para a
 * OpenAI. Chamada pela rotina /api/cron/openai-leads.
 *   ensaio  so lista
 *   validar manda com validate_only: a OpenAI confere e nao grava nada, e o
 *           CRM tambem nao registra o envio
 */
export async function reportarLeadsNovosOpenAI(opts: { ensaio?: boolean; validar?: boolean; limite?: number } = {}) {
  if (!openaiConfigurado()) return { configurado: false as const };
  const admin = createAdminClient();
  const agora = Date.now();
  const { data } = await admin
    .from("leads")
    .select("id, nome, origem, created_at, email, whatsapp, form_id, openai_oppref, openai_obref, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, valor_fechado, ja_cliente")
    .gte("created_at", new Date(agora - JANELA_OPENAI_MS).toISOString())
    .lte("created_at", new Date(agora - FOLGA_DO_WEBHOOK_MS).toISOString())
    .eq("ja_cliente", false)
    .order("created_at", { ascending: true });
  const candidatos = (data ?? []) as (Lead & Record<string, unknown>)[];
  if (candidatos.length === 0) return { configurado: true as const, pendentes: [] as LeadParaOpenAI[] };

  const { data: feitos } = await admin
    .from("ads_conversions")
    .select("lead_id")
    .eq("canal", "openai")
    .eq("tipo", "lead")
    .in("lead_id", candidatos.map((l) => l.id));
  const jaFoi = new Set((feitos ?? []).map((f) => f.lead_id as string));
  const pendentes = candidatos.filter((l) => !jaFoi.has(l.id)).slice(0, opts.limite ?? 60);
  const resumo = pendentes.map((l) => ({
    id: l.id,
    nome: (l.nome as string | null) ?? null,
    origem: l.origem as string,
    created_at: l.created_at as string,
  }));
  if (opts.ensaio) return { configurado: true as const, pendentes: resumo };

  if (opts.validar) {
    const resultados = [];
    for (const l of pendentes) {
      const r = await enviarEventoOpenAI({
        tipo: "lead",
        eventId: `validar_${l.id}`,
        quando: new Date(l.created_at as string),
        oppref: l.openai_oppref as string | null,
        obref: l.openai_obref as string | null,
        email: l.email as string | null,
        whatsapp: l.whatsapp as string | null,
        nome: l.nome as string | null,
        leadId: l.id,
        doSite: doSite(l.form_id as string | null),
        soValidar: true,
      });
      resultados.push({ id: l.id, origem: l.origem, ok: r.ok, erro: r.error });
    }
    return { configurado: true as const, validados: resultados };
  }

  for (const l of pendentes) {
    await enviarParaOpenAI(admin, l as Lead, "lead", undefined, { quando: new Date(l.created_at as string) });
  }
  return { configurado: true as const, enviados: resumo.length, pendentes: resumo };
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
    const metaLeadId = await leadIdDoFormulario(admin, lead);
    const idMeta = metaLeadId ?? lead.ctwa_clid;

    for (const linha of linhas ?? []) {
      const canal = linha.canal as Canal;
      const tipo = linha.tipo as ConversionType;

      if (canal === "google" && !idGoogle) continue;
      if (canal === "meta" && !idMeta) continue;
      if (canal === "meta" && (await jaFoiPorOutroCard(admin, lead.id, tipo, idMeta!))) continue;
      // No Google so existem qualificado e fechado; o resto viraria conversao.
      const tipoGoogle = tipo === "qualificado" || tipo === "fechado" ? tipo : null;
      if (canal === "google" && !tipoGoogle) continue;

      const agora = new Date();
      const valor = Number(linha.valor ?? 0);

      const r =
        canal === "meta"
          ? await enviarEventoMeta({
              tipo,
              leadId: metaLeadId,
              ctwaClid: lead.ctwa_clid,
              eventTime: agora,
              value: valor,
              currency: "BRL",
              eventId: linha.id as string,
            })
          : await enviarConversaoGoogle({
              identificador: idGoogle!.valor,
              idTipo: idGoogle!.tipo,
              tipo: tipoGoogle!,
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

    const metaLeadId = lead ? await leadIdDoFormulario(admin, lead as Lead) : null;

    for (const row of rows ?? []) {
      const agora = new Date();
      // Anotado porque so o Google devolve requestId; a uniao dos dois
      // retornos esconderia o campo.
      // OpenAI: busca os identificadores na hora (colunas da migration 0024).
      const oa =
        row.canal === "openai"
          ? (
              await admin
                .from("leads")
                .select("email, whatsapp, openai_oppref, openai_obref")
                .eq("id", leadId)
                .single()
            ).data
          : null;
      const r: { ok: boolean; error?: string; requestId?: string } =
        row.canal === "openai"
          ? await enviarEventoOpenAI({
              tipo: "fechado",
              eventId: row.id as string,
              quando: agora,
              oppref: (oa?.openai_oppref as string | null) ?? null,
              obref: (oa?.openai_obref as string | null) ?? null,
              email: (oa?.email as string | null) ?? null,
              whatsapp: (oa?.whatsapp as string | null) ?? null,
              leadId,
              valor,
            })
          : row.canal === "meta"
          ? await enviarEventoMeta({
              tipo: "fechado",
              leadId: metaLeadId,
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

// Estagio do CRM -> etapa do funil que vai para a Meta. "proposta" e o nome
// antigo de negociacao. Fechado tem caminho proprio (valor, Google).
const ETAPA_DO_ESTAGIO: Partial<Record<string, ConversionType>> = {
  reuniao_marcada: "reuniao_marcada",
  reuniao_feita: "reuniao_realizada",
  escopo_enviado: "escopo_enviado",
  apresentacao_marcada: "apresentacao_marcada",
  negociacao: "negociacao",
  proposta: "negociacao",
  interesse: "interesse",
};

/**
 * Avisa a Meta que o lead chegou numa etapa do funil. So a Meta, porque o
 * Google soma cada conversao como resultado e bagunca os lances; e so lead
 * de formulario, porque o Click-to-WhatsApp aceita apenas os eventos
 * padronizados. Cada etapa vai uma vez por lead. Nunca lanca.
 */
export async function reportarEtapa(leadId: string, estagio: string): Promise<void> {
  try {
    const tipo = ETAPA_DO_ESTAGIO[estagio];
    if (!tipo || (!metaConfigured() && !openaiConfigurado())) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select("id, gclid, gbraid, wbraid, meta_lead_id, ctwa_clid, valor_fechado, ja_cliente")
      .eq("id", leadId)
      .single();
    const lead = data as Lead | null;
    if (!lead || lead.ja_cliente) return;
    await enviarParaOpenAI(admin, lead, tipo);
    if (!metaConfigured()) return;
    const metaLeadId = await leadIdDoFormulario(admin, lead);
    if (!metaLeadId) return;

    await registrarEEnviar({
      admin,
      lead,
      tipo,
      canal: "meta",
      identificador: metaLeadId,
      statusSemIdentificador: "sem_lead_id",
      enviar: (rowId, _valor, quando) =>
        enviarEventoMeta({
          tipo,
          leadId: metaLeadId,
          eventTime: quando,
          eventId: rowId,
        }),
    });
  } catch (e) {
    console.error("[conv] reportarEtapa:", e);
  }
}

/**
 * Marca o lead como qualificado e avisa as plataformas sem depender de
 * alguem clicar. So o bot chama, quando o lead passa na regra dele (valor
 * natural e dinheiro com origem): "Lead Qualificado" e o evento que a
 * campanha otimiza. Reuniao marcada a mao no CRM nao qualifica sozinha
 * desde 12/11/2026 - em novembro, reuniao empurrada sem orcamento
 * confirmado virou "Lead Qualificado" e a Meta aprendeu a trazer quem
 * marca e falta. Lead que o time ja desqualificou fica como esta. Nunca
 * lanca.
 */
export async function qualificarAutomaticamente(leadId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select("qualificado, desqualificado, ja_cliente")
      .eq("id", leadId)
      .single();
    if (!data || data.desqualificado || data.ja_cliente) return;
    if (!data.qualificado) await admin.from("leads").update({ qualificado: true }).eq("id", leadId);
    await reportConversion(leadId, "qualificado");
  } catch (e) {
    console.error("[conv] qualificarAutomaticamente:", e);
  }
}

// Desqualifica um lead e avisa a Meta/Google (mesmo efeito do botao no
// CRM). Quem ja passou pela reuniao vai para a coluna Desqualificado do
// closer; antes disso, para Perdido. Usado pelo bot quando o proprio
// cliente diz que nao tem o investimento (decisao do Brenno em 16/11/2026:
// "se o cara nao tem dinheiro, e desqualificado").
export async function desqualificarLead(leadId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: l } = await admin
      .from("leads")
      .select("estagio, desqualificado, ja_cliente")
      .eq("id", leadId)
      .single();
    if (!l || l.desqualificado || l.ja_cliente) return false;
    const doCloser = [
      "reuniao_feita",
      "escopo_enviado",
      "apresentacao_marcada",
      "negociacao",
      "proposta",
      "interesse",
      "fechado",
    ].includes(l.estagio as string);
    await admin
      .from("leads")
      .update({ desqualificado: true, qualificado: false, status: "perdido", estagio: doCloser ? "desqualificado" : "perdido" })
      .eq("id", leadId);
    await reportConversion(leadId, "desqualificado");
    return true;
  } catch (e) {
    console.error("[conv] desqualificarLead:", e);
    return false;
  }
}
