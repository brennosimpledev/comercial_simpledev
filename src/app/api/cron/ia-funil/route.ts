import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  gerarProximoPasso,
  guardar,
  hojeISO,
  lerGuardado,
  montarContexto,
} from "@/lib/ia/proximoPasso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Releitura automatica do Funil pela IA. Roda a cada 30 min em horario
// comercial (vercel.json). So reanalisa lead com coisa nova (mensagem no
// WhatsApp do closer ou do SDR, reuniao, documento, follow-up) e, quando
// a IA acha um retorno, cria o follow-up sozinha se:
//   - o lead nao tem retorno marcado (ou o marcado ja venceu), ou
//   - o proprio cliente pediu/combinou a data e ela e outra.
// Follow-up criado pela IA comeca com "🤖" no registro.
//
//   GET ?secret=...&ensaio=1  -> mostra o que faria, sem gravar
//   IA_FUNIL_AUTO=0           -> desliga

const ATIVOS = ["reuniao_feita", "escopo_enviado", "apresentacao_marcada", "negociacao", "proposta", "interesse"];
const POR_RODADA = 5;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}` && q.get("secret") !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  if (process.env.IA_FUNIL_AUTO === "0") return NextResponse.json({ ok: true, skipped: "IA_FUNIL_AUTO=0" });
  const ensaio = q.get("ensaio") === "1";

  const admin = createAdminClient();
  // Sem a tabela da migration 0023 nao ha como saber o que ja foi lido:
  // nao roda, para nao reanalisar tudo a cada meia hora.
  const { error: semTabela } = await admin.from("lead_ia").select("lead_id").limit(1);
  if (semTabela) return NextResponse.json({ ok: true, skipped: "rode a migration 0023_lead_ia.sql" });

  const { data: leads, error } = await admin
    .from("leads")
    .select("id, nome, proximo_contato, updated_at")
    .in("estagio", ATIVOS)
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hoje = hojeISO();
  const fila: { id: string; nome: string; proximo: string | null; ctx: NonNullable<Awaited<ReturnType<typeof montarContexto>>> }[] = [];
  for (const l of leads ?? []) {
    const ctx = await montarContexto(admin, l.id as string);
    if (!ctx) continue;
    const salvo = await lerGuardado(admin, l.id as string);
    // Reuniao recente cuja transcricao ainda nao foi lida (o Doc do Meet
    // costuma aparecer no Drive um tempo depois da reuniao).
    const r = ctx.reuniaoParaTranscricao;
    const transcricaoPendente =
      r &&
      Date.now() - new Date(r.starts_at).getTime() < 3 * 86_400_000 &&
      salvo?.sugestao.transcricao_de !== r.id;
    if (!salvo || salvo.chave !== ctx.chave || transcricaoPendente) {
      fila.push({ id: l.id as string, nome: l.nome as string, proximo: (l.proximo_contato as string | null) ?? null, ctx });
    }
    if (fila.length >= POR_RODADA) break;
  }

  if (ensaio) {
    return NextResponse.json({ ensaio: true, reanalisaria: fila.map((f) => f.nome) });
  }

  const feitos = [];
  for (const item of fila) {
    const r = await gerarProximoPasso(item.ctx);
    if (!r.sugestao) {
      feitos.push({ lead: item.nome, erro: r.error });
      continue;
    }
    await guardar(admin, item.id, item.ctx.chave, r.sugestao);

    const f = r.sugestao.followup;
    const semRetorno = !item.proximo || item.proximo.slice(0, 10) < hoje;
    const combinadoDiferente = Boolean(f?.pedido_do_cliente && item.proximo?.slice(0, 10) !== f?.data);
    let criou = false;
    if (f && (semRetorno || combinadoDiferente)) {
      await admin.from("lead_contatos").update({ concluido: true }).eq("lead_id", item.id).eq("concluido", false);
      const { error: e1 } = await admin.from("lead_contatos").insert({
        lead_id: item.id,
        canal: f.canal,
        resumo: `🤖 ${f.motivo}`,
        proximo_em: f.data,
        concluido: false,
        created_by: null,
      });
      if (!e1) {
        await admin.from("leads").update({ proximo_contato: f.data }).eq("id", item.id);
        await admin.from("lead_ia").update({ auto_followup_em: new Date().toISOString() }).eq("lead_id", item.id);
        criou = true;
      } else {
        console.error("[cron/ia-funil] follow-up", e1.message);
      }
    }
    feitos.push({ lead: item.nome, alerta: Boolean(r.sugestao.alerta), followup: f?.data ?? null, criou_followup: criou });
  }

  return NextResponse.json({ ok: true, analisados: feitos });
}
