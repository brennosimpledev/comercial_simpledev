import { createClient } from "@/lib/supabase/server";
import { FilaFollowUps, type ItemFila } from "@/components/followups/FilaFollowUps";
import { REGUA_AUTOMATICA } from "@/lib/followups/cadence";
import { PARADO_APOS_H, leadsComSituacao, proximaDaRegua } from "@/lib/followups/situacao";

export const dynamic = "force-dynamic";

// Fila do SDR: quem esta esperando resposta nossa, quem conversou e parou,
// e quem esta na regua automatica (so para acompanhar, sai sozinha).
export default async function FollowUpsPage() {
  const supabase = await createClient();
  const agora = Date.now();
  const hojeBR = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
  const todos = await leadsComSituacao(supabase, 30);

  const adiado = (p: string | null) => Boolean(p && p.slice(0, 10) > hojeBR);
  const horas = (iso: string) => (agora - new Date(iso).getTime()) / 3600_000;

  const esperando: ItemFila[] = [];
  const parados: ItemFila[] = [];
  const regua: ItemFila[] = [];
  let adiados = 0;

  for (const { lead, s } of todos) {
    const base = {
      id: lead.id,
      nome: lead.nome,
      estagio: lead.estagio,
      botAvaliacao: lead.bot_avaliacao,
      ultimaDoCliente: s.ultimaDoCliente,
      ultimaNossa: s.ultimaNossa,
    };

    const prox = proximaDaRegua(s);
    if (prox) {
      if (!lead.bot_pausado) {
        regua.push({
          ...base,
          tipo: "regua",
          regua: {
            enviados: s.automaticos,
            total: REGUA_AUTOMATICA.length,
            proxima: prox.vence.toISOString(),
            titulo: REGUA_AUTOMATICA[prox.indice].titulo,
          },
        });
      }
      continue;
    }

    if (adiado(lead.proximo_contato)) {
      adiados++;
      continue;
    }
    if (s.ultimaDirecao === "inbound" && s.ultimaDoCliente && horas(s.ultimaDoCliente.em) >= 1) {
      esperando.push({ ...base, tipo: "esperando" });
    } else if (
      s.respondeu &&
      s.ultimaDirecao === "outbound" &&
      s.ultimaNossa &&
      horas(s.ultimaNossa.em) >= PARADO_APOS_H
    ) {
      parados.push({ ...base, tipo: "parado" });
    }
  }

  // Mais antigo primeiro: quem espera ha mais tempo vem antes.
  esperando.sort((a, b) => (a.ultimaDoCliente!.em < b.ultimaDoCliente!.em ? -1 : 1));
  parados.sort((a, b) => (a.ultimaNossa!.em < b.ultimaNossa!.em ? -1 : 1));
  regua.sort((a, b) => (a.regua!.proxima < b.regua!.proxima ? -1 : 1));

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-white">Follow-ups</h1>
      <p className="mb-5 text-sm text-slate-400">
        Leads do SDR dos últimos 30 dias, sem reunião marcada.
        {adiados > 0 && ` ${adiados} adiado${adiados > 1 ? "s" : ""} não aparece${adiados > 1 ? "m" : ""} hoje.`}
      </p>
      <FilaFollowUps esperando={esperando} parados={parados} regua={regua} />
    </div>
  );
}
