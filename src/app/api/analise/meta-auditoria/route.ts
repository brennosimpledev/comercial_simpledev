import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pente fino da conta de anuncios da Meta — somente leitura.
//
// Junta num lugar so o que fica espalhado em cinco telas: situacao da conta
// e do pagamento, campanhas, conjuntos, anuncios (com reprovacao e fase de
// aprendizado), formularios, publicos, quem tem acesso e a validade dos
// tokens que o CRM usa. Nada aqui grava na Meta.
//
//   GET ?secret=...                    conta CA 02 (META_AUDIT_ACCOUNT ou padrao)
//   GET ?secret=...&conta=act_123      outra conta

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;
const CONTA_PADRAO = "act_1344489454200596";

async function ler(caminho: string, token: string) {
  const sep = caminho.includes("?") ? "&" : "?";
  try {
    const r = await fetch(`${GRAPH}/${caminho}${sep}access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return { erro: `${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 400)}` };
    return j as Record<string, unknown>;
  } catch (e) {
    return { erro: String(e).slice(0, 300) };
  }
}

// Validade e permissoes de um token, sem devolver o token.
async function validade(nome: string, token: string | undefined) {
  if (!token) return { nome, falta: true };
  const j = (await ler(`debug_token?input_token=${encodeURIComponent(token)}`, token)) as {
    data?: Record<string, unknown>;
    erro?: string;
  };
  if (j.erro) return { nome, erro: j.erro };
  const d = j.data ?? {};
  const dia = (s: unknown) => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : s === 0 ? "nunca" : null);
  return {
    nome,
    valido: d.is_valid,
    tipo: d.type,
    aplicativo: d.application,
    app_id: d.app_id,
    expira: dia(d.expires_at),
    acesso_aos_dados_expira: dia(d.data_access_expires_at),
    permissoes: d.scopes,
    granular: d.granular_scopes,
  };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const q = request.nextUrl.searchParams;
  if (!secret || q.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ads = process.env.META_ADS_ACCESS_TOKEN;
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  const pagina = process.env.META_PAGE_ID;
  if (!ads) return NextResponse.json({ erro: "Falta META_ADS_ACCESS_TOKEN na Vercel." });
  // Consulta avulsa de leitura: ?ler=<id>[/aresta]&campos=a,b&com=ads|pagina|crm
  // So GET, so caminho simples (id e uma aresta), para investigar um objeto
  // que apareceu no pente fino sem precisar publicar de novo.
  const avulsa = q.get("ler");
  if (avulsa) {
    if (!/^[0-9a-z_]+(\/[a-z_]+)?$/i.test(avulsa)) return NextResponse.json({ erro: "caminho invalido" }, { status: 400 });
    const com = q.get("com");
    const tk = com === "pagina" ? pageToken : com === "crm" ? process.env.META_CRM_ACCESS_TOKEN : ads;
    if (!tk) return NextResponse.json({ erro: "token ausente" });
    const campos = q.get("campos");
    const extra = q.get("extra");
    const partes = [campos ? `fields=${encodeURIComponent(campos)}` : "", extra ?? ""].filter(Boolean).join("&");
    return NextResponse.json(await ler(`${avulsa}${partes ? `?${partes}` : ""}`, tk));
  }
  const conta = q.get("conta") ?? CONTA_PADRAO;
  const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
  const hoje = new Date().toISOString().slice(0, 10);

  const insight = (extra: string) =>
    ler(
      `${conta}/insights?${extra}&fields=${extra.includes("level=ad") ? "ad_id,ad_name," : ""}spend,impressions,reach,frequency,cpm,ctr,inline_link_click_ctr,actions,cost_per_action_type&limit=200`,
      ads
    );

  const [
    tokens,
    contaBase,
    contaPagamento,
    contaExtra,
    campanhas,
    conjuntos,
    anuncios,
    porAnuncio14,
    porAnuncioOut,
    porAnuncioNov,
    posicaoOut,
    posicaoNov,
    idadeOut,
    idadeNov,
    regiaoNov,
    datasets,
    publicos,
    usuariosDaConta,
    formularios,
    formulariosExtra,
    paginaInfo,
    paginaApps,
  ] = await Promise.all([
    Promise.all([
      validade("META_ADS_ACCESS_TOKEN", ads),
      validade("META_PAGE_ACCESS_TOKEN", pageToken),
      validade("META_CRM_ACCESS_TOKEN", process.env.META_CRM_ACCESS_TOKEN),
    ]),
    ler(
      `${conta}?fields=id,name,account_status,disable_reason,currency,timezone_name,amount_spent,balance,spend_cap,min_daily_budget,is_prepay_account,business{id,name},age,created_time`,
      ads
    ),
    ler(`${conta}?fields=funding_source_details,funding_source,is_notifications_enabled,tax_id_status,owner`, ads),
    ler(`${conta}?fields=failed_delivery_checks,capabilities,has_page_authorized_adaccount,user_tasks,tos_accepted`, ads),
    ler(
      `${conta}/campaigns?fields=id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,bid_strategy,special_ad_categories,issues_info,start_time,stop_time,updated_time&limit=50`,
      ads
    ),
    ler(
      `${conta}/adsets?fields=id,name,status,effective_status,issues_info,learning_stage_info,optimization_goal,optimization_sub_event,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,start_time,end_time,destination_type,promoted_object,attribution_spec,targeting,is_dynamic_creative,frequency_control_specs,pacing_type,campaign_id,updated_time&limit=50`,
      ads
    ),
    ler(
      `${conta}/ads?fields=id,name,status,effective_status,issues_info,ad_review_feedback,adset_id,campaign_id,created_time,updated_time,tracking_specs,conversion_specs,creative{id,name,object_type,call_to_action_type,object_story_spec,asset_feed_spec,effective_object_story_id,instagram_user_id,url_tags,degrees_of_freedom_spec}&limit=100`,
      ads
    ),
    ler(
      `${conta}/insights?level=ad&date_preset=last_14d&fields=ad_id,ad_name,spend,impressions,reach,frequency,cpm,ctr,inline_link_click_ctr,actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking&limit=100`,
      ads
    ),
    insight(`level=ad&time_range=${enc({ since: "2026-10-01", until: "2026-10-31" })}`),
    insight(`level=ad&time_range=${enc({ since: "2026-11-01", until: hoje })}`),
    insight(`level=account&breakdowns=publisher_platform,platform_position&time_range=${enc({ since: "2026-10-01", until: "2026-10-31" })}`),
    insight(`level=account&breakdowns=publisher_platform,platform_position&time_range=${enc({ since: "2026-11-01", until: hoje })}`),
    insight(`level=account&breakdowns=age,gender&time_range=${enc({ since: "2026-10-01", until: "2026-10-31" })}`),
    insight(`level=account&breakdowns=age,gender&time_range=${enc({ since: "2026-11-01", until: hoje })}`),
    insight(`level=account&breakdowns=region&time_range=${enc({ since: "2026-11-01", until: hoje })}`),
    ler(`${conta}/adspixels?fields=id,name,last_fired_time,is_unavailable,owner_business{id,name},creation_time`, ads),
    ler(
      `${conta}/customaudiences?fields=id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_created,time_updated,time_content_updated,lookalike_spec,data_source,retention_days&limit=50`,
      ads
    ),
    ler(`${conta}/users?fields=id,name,tasks&limit=100`, ads),
    pageToken && pagina
      ? ler(
          `${pagina}/leadgen_forms?fields=id,name,status,locale,created_time,is_optimized_for_quality,questions,privacy_policy_url,follow_up_action_url,block_display_for_non_targeted_viewer,tracking_parameters&limit=100`,
          pageToken
        )
      : Promise.resolve({ erro: "sem token da pagina" }),
    pageToken && pagina
      ? ler(
          `${pagina}/leadgen_forms?fields=id,name,leads_count,expired_leads_count,organic_leads_count,context_card,thank_you_page,question_page_custom_headline&limit=100`,
          pageToken
        )
      : Promise.resolve({ erro: "sem token da pagina" }),
    pageToken && pagina
      ? ler(
          `${pagina}?fields=id,name,is_published,verification_status,fan_count,followers_count,instagram_business_account{id,username},connected_instagram_account{id,username},has_whatsapp_business_number,whatsapp_number,leadgen_tos_accepted`,
          pageToken
        )
      : Promise.resolve({ erro: "sem token da pagina" }),
    pageToken && pagina
      ? ler(`${pagina}/subscribed_apps?fields=id,name,subscribed_fields`, pageToken)
      : Promise.resolve({ erro: "sem token da pagina" }),
  ]);

  // Quem tem acesso: depende de o token enxergar o Business.
  const biz = ((contaBase as { business?: { id?: string } }).business ?? {}).id;
  const negocio = biz
    ? await Promise.all([
        ler(`${biz}?fields=id,name,verification_status,two_factor_type,created_time,primary_page{id,name}`, ads),
        ler(`${biz}/business_users?fields=id,name,role,title&limit=100`, ads),
        ler(`${biz}/system_users?fields=id,name,role&limit=100`, ads),
        ler(`${biz}/pending_users?fields=id,role,status,created_time&limit=100`, ads),
        ler(`${biz}/agencies?fields=id,name&limit=100`, ads),
        ler(`${biz}/owned_ad_accounts?fields=id,name,account_status&limit=100`, ads),
        ler(`${biz}/owned_pixels?fields=id,name,last_fired_time&limit=100`, ads),
        ler(`${conta}/assigned_users?business=${biz}&fields=id,name,tasks&limit=100`, ads),
      ]).then(([dados, pessoas, sistema, pendentes, parceiros, contas, pixels, atribuidos]) => ({
        dados,
        pessoas,
        sistema,
        pendentes,
        parceiros,
        contas,
        pixels,
        atribuidos,
      }))
    : { erro: "o token nao enxerga o Business desta conta" };

  return NextResponse.json({
    conta,
    tokens,
    contaBase,
    contaPagamento,
    contaExtra,
    campanhas,
    conjuntos,
    anuncios,
    porAnuncio14,
    porAnuncioOut,
    porAnuncioNov,
    posicaoOut,
    posicaoNov,
    idadeOut,
    idadeNov,
    regiaoNov,
    datasets,
    publicos,
    usuariosDaConta,
    formularios,
    formulariosExtra,
    paginaInfo,
    paginaApps,
    negocio,
  });
}
