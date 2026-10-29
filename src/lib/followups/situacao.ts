import type { SupabaseClient } from "@supabase/supabase-js";
import { REGUA_AUTOMATICA, vencimentoDoPasso } from "./cadence";

// Em que pe esta a conversa de cada lead do SDR. Serve a regua automatica
// (cron) e a fila do Ronaldo (/followups), para os dois lerem a mesma coisa.

export const ESTAGIOS_SDR = ["novo", "sdr"];

// A regua so vale para quem teve o primeiro contato a partir daqui. Sem
// isso, ligar o envio mandaria de uma vez para todo lead antigo parado.
export const REGUA_DESDE = process.env.FOLLOWUP_DESDE ?? "2026-10-29T03:00:00.000Z";

// Quanto tempo sem resposta, depois da nossa ultima mensagem, para o lead
// que ja conversou entrar na fila de "parados".
export const PARADO_APOS_H = 20;

export type LeadDaFila = {
  id: string;
  nome: string;
  whatsapp: string | null;
  estagio: string;
  bot_avaliacao: string | null;
  bot_pausado: boolean;
  proximo_contato: string | null;
  created_at: string;
};

export type Fala = { em: string; texto: string };

export type Situacao = {
  /** Primeira mensagem nossa (bot, time ou regua). */
  primeiraNossa: string | null;
  /** O cliente escreveu depois do nosso primeiro contato. */
  respondeu: boolean;
  ultimaDirecao: "inbound" | "outbound" | null;
  ultimaNossa: Fala | null;
  ultimaDoCliente: Fala | null;
  /** Tentativas da regua automatica ja enviadas. */
  automaticos: number;
};

type Linha = {
  lead_id: string;
  direction: string;
  created_at: string;
  body: string | null;
  media_type: string | null;
  followup: string | null;
};

const texto = (m: Linha) =>
  ((m.body ?? "").trim() || (m.media_type ? `[${m.media_type}]` : "")).slice(0, 280);

/**
 * Leads ativos do SDR dos ultimos `dias`, sem reuniao, sem cliente e sem
 * desqualificar, cada um com a situacao da conversa.
 */
export async function leadsComSituacao(
  supabase: SupabaseClient,
  dias = 30
): Promise<{ lead: LeadDaFila; s: Situacao }[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, nome, whatsapp, estagio, bot_avaliacao, bot_pausado, proximo_contato, created_at")
    .in("estagio", ESTAGIOS_SDR)
    .eq("status", "ativo")
    .eq("desqualificado", false)
    .eq("ja_cliente", false)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(500);
  const lista = (leads ?? []) as LeadDaFila[];
  if (lista.length === 0) return [];

  const ids = lista.map((l) => l.id);
  const comReuniao = new Set<string>();
  const linhas: Linha[] = [];

  // Em lotes: a API devolve no maximo 1000 linhas por consulta.
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const { data: reunioes } = await supabase.from("meetings").select("lead_id").in("lead_id", lote);
    for (const r of reunioes ?? []) comReuniao.add(r.lead_id as string);

    for (let de = 0; ; de += 1000) {
      const { data } = await supabase
        .from("lead_messages")
        .select("lead_id, direction, created_at, body, media_type, followup:raw->>followup")
        .in("lead_id", lote)
        .order("created_at", { ascending: true })
        .range(de, de + 999);
      linhas.push(...((data ?? []) as Linha[]));
      if (!data || data.length < 1000) break;
    }
  }

  const porLead = new Map<string, Linha[]>();
  for (const m of linhas) {
    const l = porLead.get(m.lead_id) ?? [];
    l.push(m);
    porLead.set(m.lead_id, l);
  }

  return lista
    .filter((l) => !comReuniao.has(l.id))
    .map((lead) => {
      const msgs = porLead.get(lead.id) ?? [];
      const iPrimeira = msgs.findIndex((m) => m.direction === "outbound");
      const ultima = msgs[msgs.length - 1];
      const nossa = [...msgs].reverse().find((m) => m.direction === "outbound");
      const doCliente = [...msgs].reverse().find((m) => m.direction === "inbound");
      return {
        lead,
        s: {
          primeiraNossa: iPrimeira === -1 ? null : msgs[iPrimeira].created_at,
          respondeu: iPrimeira !== -1 && msgs.slice(iPrimeira + 1).some((m) => m.direction === "inbound"),
          ultimaDirecao: ultima ? (ultima.direction === "inbound" ? "inbound" : "outbound") : null,
          ultimaNossa: nossa ? { em: nossa.created_at, texto: texto(nossa) } : null,
          ultimaDoCliente: doCliente ? { em: doCliente.created_at, texto: texto(doCliente) } : null,
          automaticos: msgs.filter((m) => m.followup?.startsWith("auto_")).length,
        },
      };
    });
}

/** Proxima tentativa automatica, ou null se o lead nao esta na regua. */
export function proximaDaRegua(
  s: Situacao,
  desde = REGUA_DESDE
): { indice: number; vence: Date } | null {
  if (!s.primeiraNossa || s.respondeu) return null;
  if (new Date(s.primeiraNossa).getTime() < new Date(desde).getTime()) return null;
  if (s.automaticos >= REGUA_AUTOMATICA.length) return null;
  return { indice: s.automaticos, vence: vencimentoDoPasso(new Date(s.primeiraNossa), s.automaticos) };
}
