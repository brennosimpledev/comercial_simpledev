import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolutionConfigured, sendWhatsAppText } from "@/lib/evolution/client";
import { horariosLivres } from "@/lib/agenda";
import { atenderReuniao, ESPERA_TIME_MIN } from "@/lib/bot/reuniao";
import { nomeDoFormulario, primeiroNome } from "@/lib/followups/cadence";
import {
  horaDeMandar,
  lembretesLigados,
  texto1h,
  textoFuro,
  textoVespera,
  vencimentoVespera,
} from "@/lib/lembretes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Confirmacao e lembretes de reuniao. Roda a cada 15 min (vercel.json).
//   - vespera: dia util anterior as 10h, pede confirmacao
//   - 1h antes: lembra com o link
//   - furo: reuniao marcada como furada, oferece horarios
//   - pendentes: cliente falou sobre a reuniao e o time nao respondeu em
//     20 min; o bot de reuniao assume
//
// Desligado por padrao: so envia com LEMBRETES_AUTO ligado no Vercel.
//   GET ?secret=...&ensaio=1  -> mostra o que mandaria agora, sem enviar

type Linha = {
  id: string;
  lead_id: string;
  starts_at: string;
  status: string;
  meet_link: string | null;
  marcada_em: string | null;
  confirmacao: string | null;
  lembrete_vespera_em: string | null;
  lembrete_1h_em: string | null;
  aviso_furo_em: string | null;
  bot_ultima_msg: string | null;
  leads: { nome: string; whatsapp: string | null; bot_pausado: boolean } | null;
};

const H = 3600_000;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}` && q.get("secret") !== cronSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const ensaio = q.get("ensaio") === "1";
  if (!ensaio) {
    if (!lembretesLigados()) return NextResponse.json({ ok: true, skipped: "LEMBRETES_AUTO desligado" });
    if (!evolutionConfigured()) return NextResponse.json({ ok: true, skipped: "evolution not configured" });
  }

  const supabase = createAdminClient();
  const agora = Date.now();

  const { data, error } = await supabase
    .from("meetings")
    .select(
      "id, lead_id, starts_at, status, meet_link, marcada_em, confirmacao, lembrete_vespera_em, lembrete_1h_em, aviso_furo_em, bot_ultima_msg, leads(nome, whatsapp, bot_pausado)"
    )
    .in("status", ["agendada", "furada"])
    .gte("starts_at", new Date(agora - 4 * 86_400_000).toISOString())
    .lte("starts_at", new Date(agora + 5 * 86_400_000).toISOString())
    .order("starts_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message, dica: "Rode a migration 0021 no Supabase." }, { status: 500 });
  }
  const reunioes = ((data ?? []) as unknown as Linha[]).filter(
    (r) => r.leads?.whatsapp && !r.leads.bot_pausado
  );

  // Nome do formulario de cada lead: o do cadastro as vezes e da empresa.
  const nomes = new Map<string, string>();
  const ids = [...new Set(reunioes.map((r) => r.lead_id))];
  if (ids.length) {
    const { data: entradas } = await supabase
      .from("lead_messages")
      .select("lead_id, direction, body")
      .in("lead_id", ids)
      .eq("direction", "inbound")
      .ilike("body", "%full name%");
    for (const id of ids) {
      const doLead = (entradas ?? []).filter((m) => m.lead_id === id) as { direction: string; body: string | null }[];
      nomes.set(id, primeiroNome(nomeDoFormulario(doLead)));
    }
  }

  // Movimento recente na conversa: com o time falando (ou o cliente acabando
  // de escrever), o lembrete automatico atropela. Em 30/10 o lembrete de 1h
  // saiu 18 min depois de o cliente avisar que ia adiar.
  const ultimaHumana = new Map<string, number>();
  const ultimaDoCliente = new Map<string, number>();
  if (ids.length) {
    const { data: recentes } = await supabase
      .from("lead_messages")
      .select("lead_id, direction, created_at, followup:raw->>followup, bot:raw->>bot, lembrete:raw->>lembrete")
      .in("lead_id", ids)
      .gte("created_at", new Date(agora - 12 * H).toISOString());
    for (const m of recentes ?? []) {
      const t = new Date(m.created_at as string).getTime();
      const mapa =
        m.direction === "inbound"
          ? ultimaDoCliente
          : m.followup || m.bot || m.lembrete
            ? null
            : ultimaHumana;
      if (mapa) mapa.set(m.lead_id as string, Math.max(mapa.get(m.lead_id as string) ?? 0, t));
    }
  }
  const timeFalouHa = (id: string) => agora - (ultimaHumana.get(id) ?? 0);
  const clienteFalouHa = (id: string) => agora - (ultimaDoCliente.get(id) ?? 0);

  type Envio = { reuniao: Linha; tipo: "vespera" | "1h" | "furo"; texto: string };
  const envios: Envio[] = [];
  const pode = horaDeMandar();

  for (const r of reunioes) {
    const inicio = new Date(r.starts_at);
    const falta = inicio.getTime() - agora;
    const nome = nomes.get(r.lead_id) ?? "";

    if (r.status === "agendada") {
      const desdeMarcada = r.marcada_em ? agora - new Date(r.marcada_em).getTime() : Infinity;
      if (
        pode &&
        !r.lembrete_vespera_em &&
        !r.confirmacao &&
        agora >= vencimentoVespera(inicio).getTime() &&
        falta >= 2 * H &&
        // Recem-marcada ja recebeu a mensagem de agendamento.
        desdeMarcada >= 4 * H &&
        // O time falou com ele nas ultimas 12h: a confirmacao e com o time.
        timeFalouHa(r.lead_id) >= 12 * H
      ) {
        envios.push({ reuniao: r, tipo: "vespera", texto: textoVespera(nome, inicio) });
      } else if (
        !r.lembrete_1h_em &&
        r.confirmacao !== "remarcar" &&
        r.confirmacao !== "cancelar" &&
        falta <= 75 * 60_000 &&
        falta >= 10 * 60_000 &&
        timeFalouHa(r.lead_id) >= 3 * H &&
        clienteFalouHa(r.lead_id) >= 3 * H
      ) {
        envios.push({ reuniao: r, tipo: "1h", texto: texto1h(nome, inicio, r.meet_link) });
      }
    } else if (r.status === "furada" && !r.aviso_furo_em && pode && falta < 0) {
      // Ja tem outra reuniao marcada, ou o time ja falou com ele depois: nao precisa.
      const outra = reunioes.some(
        (x) => x.lead_id === r.lead_id && x.status === "agendada" && new Date(x.starts_at).getTime() > agora
      );
      if (outra) continue;
      const { count: falouDepois } = await supabase
        .from("lead_messages")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", r.lead_id)
        .eq("direction", "outbound")
        .gte("created_at", r.starts_at)
        .is("raw->>bot", null);
      if ((falouDepois ?? 0) > 0) continue;
      const horarios = await horariosLivres(supabase);
      envios.push({ reuniao: r, tipo: "furo", texto: textoFuro(nome, inicio, horarios) });
    }
  }

  // Cliente falou sobre a reuniao e ninguem respondeu em 20 min.
  const pendentes: string[] = [];
  for (const id of ids) {
    const { data: ultima } = await supabase
      .from("lead_messages")
      .select("direction, created_at, wa_message_id")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ultima || ultima.direction !== "inbound") continue;
    if (agora - new Date(ultima.created_at as string).getTime() < ESPERA_TIME_MIN * 60_000) continue;
    // So o que chegou depois da reuniao ser marcada, e nunca o que o bot ja avaliou.
    const r = reunioes.find((x) => x.lead_id === id);
    if (!r || r.bot_ultima_msg === (ultima.wa_message_id ?? ultima.created_at)) continue;
    if (r.marcada_em && new Date(ultima.created_at as string) < new Date(r.marcada_em)) continue;
    pendentes.push(id);
  }

  if (ensaio) {
    return NextResponse.json({
      ensaio: true,
      ligado: lembretesLigados(),
      reunioes: reunioes.length,
      mandaria: envios.map((e) => ({
        lead: e.reuniao.leads?.nome,
        reuniao: e.reuniao.starts_at,
        tipo: e.tipo,
        texto: e.texto,
      })),
      pendentes_para_o_bot: pendentes.length,
    });
  }

  let enviados = 0;
  const campo = { vespera: "lembrete_vespera_em", "1h": "lembrete_1h_em", furo: "aviso_furo_em" } as const;
  for (const e of envios) {
    const envio = await sendWhatsAppText(e.reuniao.leads!.whatsapp!, e.texto);
    if (!envio.ok) {
      console.error("[cron/lembretes]", e.reuniao.id, envio.error);
      continue;
    }
    await supabase.from("lead_messages").insert({
      lead_id: e.reuniao.lead_id,
      direction: "outbound",
      body: e.texto,
      status: "sent",
      wa_message_id: envio.waMessageId ?? null,
      raw: { bot: true, lembrete: e.tipo, reuniao: e.reuniao.id },
    });
    await supabase
      .from("meetings")
      .update({ [campo[e.tipo]]: new Date().toISOString() })
      .eq("id", e.reuniao.id);
    enviados++;
  }

  // Cada atendimento chama a IA; dois por rodada cabem no tempo da funcao.
  const atendidos = [];
  for (const id of pendentes.slice(0, 2)) {
    atendidos.push(await atenderReuniao(supabase, id, { origem: "cron" }));
  }

  return NextResponse.json({ ok: true, enviados, pendentes: pendentes.length, atendidos });
}
