// Primeiro contato com quem preencheu o formulario da Meta e nao chamou no
// WhatsApp. No feriado de Finados 2026, de 16 leads de formulario so 6
// escreveram; os outros ficaram sem conversa nenhuma ate o time voltar.
//
// So das 7h as 22h, e so depois de alguns minutos: a mensagem pronta do
// formulario costuma chegar em menos de um minuto, e quem escreve e
// atendido pelo bot de sempre. Em horario comercial quem chama e o Ronaldo;
// o bot so entra se ninguem chamou em meia hora, e a resposta fica com ele.
//
// A conversa pode estar em outro card: a pessoa preenche com um numero e
// escreve de outro (o Christian Silva do formulario era o "Cristiano brisa"
// do WhatsApp, em 30/10). Por isso confere telefone E e-mail antes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { consultarNumeros, sendWhatsAppText, variantesBR } from "@/lib/evolution/client";
import { botAtivo, foraDoHorario, numeroDeCliente } from "@/lib/bot/atendente";
import { primeiroNome } from "@/lib/followups/cadence";
import { brCanonical, last8 } from "@/lib/phone";
import { emailDoFormulario, resposta, respostasDoFormulario } from "@/lib/bot/formulario";

const TZ = "America/Sao_Paulo";

// Quanto esperar a pessoa escrever sozinha antes de chamarmos.
export const ESPERA_MIN = Number(process.env.PRIMEIRO_CONTATO_ESPERA_MIN ?? 5);
// Em horario comercial, quanto esperar o Ronaldo chamar antes do bot.
export const ESPERA_COMERCIAL_MIN = Number(process.env.PRIMEIRO_CONTATO_ESPERA_COMERCIAL_MIN ?? 30);
// Lead mais velho que isso ja e caso do time, nao de primeiro contato.
const JANELA_H = 16;
const HORA_DE = 7;
const HORA_ATE = 22;
const POR_RODADA = 10;

// Ligado por padrao; PRIMEIRO_CONTATO_AUTO=0 no Vercel desliga.
export function primeiroContatoLigado() {
  const v = (process.env.PRIMEIRO_CONTATO_AUTO ?? "1").toLowerCase();
  return v !== "0" && v !== "off" && v !== "false";
}

function horaLocal(agora = new Date()) {
  return new Date(agora.toLocaleString("en-US", { timeZone: TZ })).getHours();
}

export function horaDeChamar(agora = new Date()) {
  const h = horaLocal(agora);
  return h >= HORA_DE && h < HORA_ATE;
}

const SITUACAO: Record<string, string> = {
  "tenho_uma_ideia_de_app/sistema": " e tem uma ideia de app/sistema",
  "automatizar_processos_que_já_existem": " e quer automatizar processos que já existem",
  "preciso_desenvolver_algo_rápido_com_acompanhamento": " e precisa desenvolver algo rápido, com acompanhamento",
  "tentei_outras_soluções_que_não_funcionaram": " e já tentou outras soluções que não funcionaram",
};

export function esperaAgora(agora = new Date()) {
  return foraDoHorario(agora) ? ESPERA_MIN : ESPERA_COMERCIAL_MIN;
}

export function textoPrimeiroContato(nome: string, necessidade: string | null | undefined, agora = new Date()) {
  const h = horaLocal(agora);
  const saudacao = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const situacao = SITUACAO[resposta(respostasDoFormulario(necessidade), "qual_dessas_situa")] ?? "";
  // Em horario comercial o bot nao responde; quem continua e o time.
  const pedido = foraDoHorario(agora)
    ? "O time comercial está fora do expediente agora, mas eu já adianto o seu atendimento pra você não ficar esperando.\n\n" +
      "Me conta em poucas palavras: o que você quer desenvolver?"
    : "Pra adiantar o seu atendimento com o time comercial, me conta em poucas palavras: o que você quer desenvolver?";
  return (
    `${saudacao}${nome ? `, ${nome}` : ""}! Aqui é o assistente da SimpleDEV 👋\n` +
    `Vi que você preencheu nosso formulário${situacao}. ${pedido}`
  );
}

type Lead = {
  id: string;
  nome: string | null;
  whatsapp: string | null;
  email: string | null;
  necessidade: string | null;
  created_at: string;
};

// A pessoa ja esta conversando em outro card (mesmo telefone ou mesmo
// e-mail), ou mandou o e-mail do formulario de outro numero.
async function conversaEmOutroLugar(supabase: SupabaseClient, lead: Lead) {
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const ids = new Set<string>();

  const { data: mesmoNumero } = await supabase
    .from("leads")
    .select("id, whatsapp")
    .like("whatsapp_digits", `%${last8(lead.whatsapp as string)}`)
    .neq("id", lead.id)
    .limit(10);
  for (const o of mesmoNumero ?? []) {
    if (brCanonical(o.whatsapp as string | null) === brCanonical(lead.whatsapp)) ids.add(o.id as string);
  }

  const email = emailDoFormulario(lead.necessidade, lead.email);
  if (email) {
    const { data: mesmoEmail } = await supabase.from("leads").select("id").ilike("email", email).neq("id", lead.id).limit(10);
    for (const o of mesmoEmail ?? []) ids.add(o.id as string);
    const { count: citou } = await supabase
      .from("lead_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "inbound")
      .gte("created_at", desde)
      .ilike("body", `%${email}%`);
    if ((citou ?? 0) > 0) return "email_em_outra_conversa";
  }

  if (ids.size === 0) return null;
  const { count } = await supabase
    .from("lead_messages")
    .select("id", { count: "exact", head: true })
    .in("lead_id", [...ids])
    .gte("created_at", desde);
  return (count ?? 0) > 0 ? "conversa_em_outro_card" : null;
}

export type Plano = { lead: Lead; destino: string; texto: string };

// Quem recebe o primeiro contato agora. Nao envia nada.
export async function quemChamar(supabase: SupabaseClient, agora = new Date()) {
  const ate = new Date(agora.getTime() - esperaAgora(agora) * 60_000).toISOString();
  const de = new Date(agora.getTime() - JANELA_H * 3600_000).toISOString();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, nome, whatsapp, email, necessidade, created_at")
    .eq("origem", "meta_ads")
    .in("estagio", ["novo", "sdr"])
    .eq("status", "ativo")
    .eq("ja_cliente", false)
    .eq("bot_pausado", false)
    .eq("desqualificado", false)
    .not("whatsapp", "is", null)
    .gte("created_at", de)
    .lte("created_at", ate)
    .order("created_at", { ascending: true })
    .limit(50);

  const ids = (leads ?? []).map((l) => l.id as string);
  if (ids.length === 0) return { plano: [] as Plano[], pulados: [] as { nome: string | null; motivo: string }[] };
  const [{ data: comMensagem }, { data: comReuniao }] = await Promise.all([
    supabase.from("lead_messages").select("lead_id").in("lead_id", ids),
    supabase.from("meetings").select("lead_id").in("lead_id", ids),
  ]);
  const ocupados = new Set([...(comMensagem ?? []), ...(comReuniao ?? [])].map((m) => m.lead_id as string));

  const plano: Plano[] = [];
  const pulados: { nome: string | null; motivo: string }[] = [];
  for (const lead of (leads ?? []) as Lead[]) {
    if (plano.length >= POR_RODADA) break;
    if (ocupados.has(lead.id)) continue;
    if (await numeroDeCliente(supabase, lead.whatsapp as string)) {
      pulados.push({ nome: lead.nome, motivo: "numero_de_cliente" });
      continue;
    }
    const outro = await conversaEmOutroLugar(supabase, lead);
    if (outro) {
      pulados.push({ nome: lead.nome, motivo: outro });
      continue;
    }
    // Numero digitado no formulario as vezes vem sem o 9 ou nem tem
    // WhatsApp. Sem a consulta (Evolution fora), tenta o numero como veio.
    const consulta = await consultarNumeros(variantesBR(lead.whatsapp as string));
    const achado = consulta?.find((n) => n.exists);
    if (consulta && !achado) {
      pulados.push({ nome: lead.nome, motivo: "numero_sem_whatsapp" });
      continue;
    }
    const destino = achado ? (achado.number ?? achado.jid?.split("@")[0] ?? (lead.whatsapp as string)) : (lead.whatsapp as string);
    plano.push({ lead, destino, texto: textoPrimeiroContato(primeiroNome(lead.nome), lead.necessidade, agora) });
  }
  return { plano, pulados };
}

export function podeChamarAgora(agora = new Date()) {
  if (!primeiroContatoLigado()) return "desligado";
  if (!botAtivo()) return "bot_desligado";
  if (!horaDeChamar(agora)) return "fora_da_janela_7h_22h";
  return null;
}

export async function enviarPrimeiroContato(supabase: SupabaseClient, p: Plano) {
  // Confere de novo logo antes: a pessoa pode ter escrito durante a rodada.
  const { count } = await supabase
    .from("lead_messages")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", p.lead.id);
  if ((count ?? 0) > 0) return { ok: false, motivo: "ja_tem_mensagem" };

  const envio = await sendWhatsAppText(p.destino, p.texto);
  if (!envio.ok) return { ok: false, motivo: envio.error ?? "falha_envio" };
  await supabase.from("lead_messages").insert({
    lead_id: p.lead.id,
    direction: "outbound",
    body: p.texto,
    wa_message_id: envio.waMessageId ?? null,
    status: "sent",
    raw: { bot: true, primeiro_contato: true },
  });
  return { ok: true };
}
