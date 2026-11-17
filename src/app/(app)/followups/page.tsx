import { createClient } from "@/lib/supabase/server";
import { FilaFollowUps, type ItemFila, type Retorno } from "@/components/followups/FilaFollowUps";
import { REGUA_AUTOMATICA } from "@/lib/followups/cadence";
import { PARADO_APOS_H, leadsComSituacao, proximaDaRegua } from "@/lib/followups/situacao";

export const dynamic = "force-dynamic";

// Follow-ups em kanban (17/11/2026): uma coluna para cada uma das 10
// tentativas. Cada lead fica na coluna do proximo follow-up que precisa
// receber e anda sozinho quando a mensagem sai (pela regua, pelo CRM ou
// pelo WhatsApp do SDR), porque a coluna sai da contagem das mensagens.
//
//   - Nunca respondeu: a regua automatica manda; coluna = proximo passo.
//   - Conversou e parou (4h sem resposta): o Ronaldo manda; coluna =
//     follow-ups ja feitos desde a ultima fala do cliente + 1 (a primeira
//     mensagem depois do cliente e a resposta da conversa, nao follow-up).
//   - Cliente escreveu por ultimo: faixa "Responder agora", no topo.
//   - Sem conversa ha mais de 7 dias ou passou da 10a: "Frios", recolhido.
//   - Retorno agendado: sai do quadro ate o dia e aparece em "Retornos".
const FRIO_APOS_DIAS = 7;
const COLUNAS = REGUA_AUTOMATICA.length;

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const agora = Date.now();
  const hojeBR = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
  const todos = await leadsComSituacao(supabase, 30);

  const adiado = (p: string | null) => Boolean(p && p.slice(0, 10) > hojeBR);
  const horas = (iso: string) => (agora - new Date(iso).getTime()) / 3600_000;
  const recenteDe = (s: { ultimaDoCliente: { em: string } | null; ultimaNossa: { em: string } | null }) =>
    (s.ultimaDoCliente ?? s.ultimaNossa)?.em ?? new Date(0).toISOString();

  const responder: ItemFila[] = [];
  const colunas: ItemFila[][] = Array.from({ length: COLUNAS }, () => []);
  const frios: ItemFila[] = [];

  for (const { lead, s } of todos) {
    if (adiado(lead.proximo_contato)) continue;
    const base = {
      id: lead.id,
      nome: lead.nome,
      estagio: lead.estagio,
      botAvaliacao: lead.bot_avaliacao,
      ultimaDoCliente: s.ultimaDoCliente,
      ultimaNossa: s.ultimaNossa,
      retornoVencido: Boolean(lead.proximo_contato),
    };

    const prox = proximaDaRegua(s);
    if (prox) {
      if (lead.bot_pausado) continue;
      colunas[prox.indice].push({
        ...base,
        tipo: "regua",
        regua: {
          enviados: s.automaticos,
          total: COLUNAS,
          proxima: prox.vence.toISOString(),
          titulo: REGUA_AUTOMATICA[prox.indice].titulo,
        },
      });
      continue;
    }

    const frio = horas(recenteDe(s)) > FRIO_APOS_DIAS * 24;
    if (s.ultimaDirecao === "inbound" && s.ultimaDoCliente && horas(s.ultimaDoCliente.em) >= 1) {
      (frio ? frios : responder).push({ ...base, tipo: "esperando" });
    } else if (
      (s.respondeu || s.falouDeVerdade) &&
      s.ultimaDirecao === "outbound" &&
      s.ultimaNossa &&
      horas(s.ultimaNossa.em) >= PARADO_APOS_H
    ) {
      const feitos = Math.max(0, s.nossasDesdeCliente - 1);
      const item: ItemFila = { ...base, tipo: "parado", feitos };
      if (frio || feitos >= COLUNAS) frios.push(item);
      else colunas[feitos].push(item);
    }
  }

  // Conversa mais recente primeiro: os de ontem nao ficam para depois.
  const ordem = (a: ItemFila, b: ItemFila) =>
    recenteDe(a) > recenteDe(b) ? -1 : 1;
  responder.sort(ordem);
  frios.sort(ordem);
  for (const c of colunas) {
    // Na coluna, quem a regua manda primeiro fica em cima; os do Ronaldo,
    // conversa mais recente primeiro.
    c.sort((a, b) =>
      a.tipo === "regua" && b.tipo === "regua"
        ? a.regua!.proxima < b.regua!.proxima
          ? -1
          : 1
        : a.tipo === "regua"
          ? 1
          : b.tipo === "regua"
            ? -1
            : ordem(a, b)
    );
  }

  // Retornos agendados do SDR, inclusive desqualificado ("agora nao, me
  // chama em janeiro"). Retorno do funil do closer fica no Funil. Data que
  // ja chegou de lead ativo nao aparece aqui: ele voltou para o quadro.
  const { data: comRetorno } = await supabase
    .from("leads")
    .select("id, nome, estagio, desqualificado, proximo_contato")
    .not("proximo_contato", "is", null)
    .eq("ja_cliente", false)
    .in("estagio", ["novo", "sdr", "perdido"])
    .order("proximo_contato", { ascending: true })
    .limit(300);
  const retornos: Retorno[] = ((comRetorno ?? []) as Retorno[])
    .map((r) => ({ ...r, vencido: (r.proximo_contato ?? "").slice(0, 10) <= hojeBR }))
    .filter((r) => !r.vencido || r.estagio === "perdido" || r.desqualificado);

  const titulos = REGUA_AUTOMATICA.map((p) => p.titulo);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-white">Follow-ups</h1>
      <p className="mb-4 text-sm text-slate-400">
        Cada coluna é um follow-up (1º ao 10º). O card anda sozinho quando a mensagem sai.
      </p>
      <FilaFollowUps responder={responder} colunas={colunas} titulos={titulos} frios={frios} retornos={retornos} />
    </div>
  );
}
