import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Busca de lead por nome — somente leitura.
//
//   GET ?secret=...&nome=darius

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (secret && q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const nome = (q.get("nome") ?? "").trim();
  if (nome.length < 3) return NextResponse.json({ error: "nome curto demais" }, { status: 400 });

  const admin = createAdminClient();
  // O nome do cadastro as vezes e o do perfil do WhatsApp ou da empresa:
  // procura tambem nas mensagens (o "Full name" do formulario vem nelas).
  const { data: nasMensagens } = await admin
    .from("lead_messages")
    .select("lead_id")
    .ilike("body", `%${nome}%`)
    .limit(50);
  const porMensagem = [...new Set((nasMensagens ?? []).map((m) => m.lead_id as string))];

  const { data, error } = await admin
    .from("leads")
    .select("id, nome, origem, estagio, status, valor_fechado, ja_cliente, meta_lead_id, ctwa_clid, gclid, created_at, updated_at")
    .or(
      [`nome.ilike.%${nome}%`, `email.ilike.%${nome}%`, ...(porMensagem.length ? [`id.in.(${porMensagem.join(",")})`] : [])].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((l) => l.id as string);
  const { data: reunioes } = await admin
    .from("meetings")
    .select("lead_id, status, starts_at")
    .in("lead_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  // &meta=1: procura tambem nos leads de formulario guardados na Meta
  // (a Graph API devolve os ultimos 90 dias de cada formulario).
  let naMeta: { form_id: string; lead_id: string; criado: string; campos: Record<string, string> }[] | undefined;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (q.get("meta") === "1" && token) {
    naMeta = [];
    const { data: forms } = await admin.from("leads").select("form_id").not("form_id", "is", null).limit(1000);
    const graph = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;
    const alvo = nome.toLowerCase();
    for (const formId of [...new Set((forms ?? []).map((f) => f.form_id as string))]) {
      let url: string | null =
        `${graph}/${formId}/leads?fields=id,created_time,field_data&limit=100&access_token=${encodeURIComponent(token)}`;
      for (let pagina = 0; url && pagina < 10; pagina++) {
        const r = await fetch(url);
        if (!r.ok) break;
        const j = (await r.json()) as {
          data?: { id: string; created_time: string; field_data?: { name: string; values?: string[] }[] }[];
          paging?: { next?: string };
        };
        for (const l of j.data ?? []) {
          const campos = Object.fromEntries((l.field_data ?? []).map((f) => [f.name, (f.values ?? []).join(" ")]));
          if (Object.values(campos).some((v) => v.toLowerCase().includes(alvo))) {
            naMeta.push({ form_id: formId, lead_id: l.id, criado: l.created_time, campos });
          }
        }
        url = j.paging?.next ?? null;
      }
    }
  }

  return NextResponse.json({
    ...(naMeta ? { na_meta: naMeta } : {}),
    leads: (data ?? []).map((l) => ({
      ...l,
      meta_lead_id: Boolean(l.meta_lead_id),
      ctwa_clid: Boolean(l.ctwa_clid),
      gclid: Boolean(l.gclid),
      reunioes: (reunioes ?? []).filter((r) => r.lead_id === l.id).map((r) => `${r.status} ${String(r.starts_at).slice(0, 10)}`),
    })),
  });
}
