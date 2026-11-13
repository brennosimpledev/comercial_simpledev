// Instancias da Evolution (WhatsApp do SDR e do closer). SERVER-ONLY.
//
// A linha do SDR e a instancia de EVOLUTION_INSTANCE, a de sempre: o bot,
// a regua e o webhook /api/webhook/whatsapp dependem dela. A do closer e
// outra instancia, so para leitura das conversas (webhook
// /api/webhook/whatsapp-closer, que nao cria lead nem aciona o bot).
//
// Criar e listar instancias pede a chave GLOBAL da Evolution
// (AUTHENTICATION_API_KEY do servidor). Sem EVOLUTION_GLOBAL_API_KEY usa
// EVOLUTION_API_KEY, que funciona se ela for a global.

const BASE = process.env.EVOLUTION_API_URL;
const CHAVE = process.env.EVOLUTION_GLOBAL_API_KEY || process.env.EVOLUTION_API_KEY;

export type Papel = "sdr" | "closer";

export const NOME_DA_INSTANCIA: Record<Papel, string> = {
  sdr: process.env.EVOLUTION_INSTANCE ?? "",
  closer: process.env.EVOLUTION_CLOSER_INSTANCE || "simpledev-closer",
};

export const CAMINHO_DO_WEBHOOK: Record<Papel, string> = {
  sdr: "/api/webhook/whatsapp",
  closer: "/api/webhook/whatsapp-closer",
};

export type Estado = "open" | "connecting" | "close" | "inexistente" | "desconhecido";

export type Instancia = {
  nome: string;
  estado: Estado;
  numero: string | null;
  perfil: string | null;
};

export type Webhook = { url: string | null; ativo: boolean; eventos: string[]; temSegredo: boolean };

export function evolutionBaseConfigurada() {
  return Boolean(BASE && CHAVE);
}

async function chamar(caminho: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: CHAVE ?? "", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const texto = await res.text();
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { ok: res.ok, status: res.status, corpo };
}

function erroDe(r: { status: number; corpo: unknown }) {
  const c = r.corpo as { response?: { message?: unknown }; message?: unknown; error?: unknown } | null;
  const msg = c?.response?.message ?? c?.message ?? c?.error ?? r.corpo;
  const texto = Array.isArray(msg) ? msg.join("; ") : typeof msg === "string" ? msg : JSON.stringify(msg);
  if (r.status === 401 || r.status === 403) {
    return "A chave da Evolution não tem permissão para isso. Configure EVOLUTION_GLOBAL_API_KEY no Vercel com a chave global do servidor.";
  }
  return `Evolution respondeu ${r.status}: ${String(texto).slice(0, 300)}`;
}

function normalizarEstado(v: unknown): Estado {
  const s = String(v ?? "").toLowerCase();
  if (s === "open" || s === "connected") return "open";
  if (s === "connecting" || s === "qrcode") return "connecting";
  if (s === "close" || s === "closed" || s === "disconnected") return "close";
  return "desconhecido";
}

// O formato mudou entre versoes: a v2 devolve a lista plana, a v1 aninha em
// "instance".
function normalizarInstancia(item: Record<string, unknown>): Instancia {
  const i = (item.instance as Record<string, unknown> | undefined) ?? item;
  const dono = (i.ownerJid ?? i.owner ?? i.number ?? null) as string | null;
  return {
    nome: String(i.name ?? i.instanceName ?? ""),
    estado: normalizarEstado(i.connectionStatus ?? i.status ?? i.state),
    numero: dono ? String(dono).split("@")[0] : null,
    perfil: (i.profileName ?? null) as string | null,
  };
}

export async function listarInstancias(): Promise<{ instancias: Instancia[]; erro?: string }> {
  if (!evolutionBaseConfigurada()) return { instancias: [], erro: "Evolution não configurada (EVOLUTION_API_URL)." };
  try {
    const r = await chamar("/instance/fetchInstances");
    if (!r.ok) return { instancias: [], erro: erroDe(r) };
    const lista = Array.isArray(r.corpo) ? r.corpo : [];
    return { instancias: lista.map((x) => normalizarInstancia(x as Record<string, unknown>)).filter((i) => i.nome) };
  } catch (e) {
    return { instancias: [], erro: `Não consegui falar com a Evolution: ${String(e).slice(0, 200)}` };
  }
}

export async function estadoDaInstancia(nome: string): Promise<Estado> {
  if (!evolutionBaseConfigurada() || !nome) return "desconhecido";
  try {
    const r = await chamar(`/instance/connectionState/${encodeURIComponent(nome)}`);
    if (r.status === 404) return "inexistente";
    if (!r.ok) return "desconhecido";
    const c = r.corpo as { instance?: { state?: string }; state?: string } | null;
    return normalizarEstado(c?.instance?.state ?? c?.state);
  } catch {
    return "desconhecido";
  }
}

export async function webhookDaInstancia(nome: string, segredo: string | undefined): Promise<Webhook | null> {
  try {
    const r = await chamar(`/webhook/find/${encodeURIComponent(nome)}`);
    if (!r.ok || !r.corpo || typeof r.corpo !== "object") return null;
    const c = ((r.corpo as { webhook?: unknown }).webhook ?? r.corpo) as Record<string, unknown>;
    const url = (c.url as string | undefined) ?? null;
    const cabecalhos = (c.headers ?? {}) as Record<string, string>;
    const temSegredo = Boolean(
      segredo && ((url ?? "").includes(`token=${segredo}`) || cabecalhos["x-webhook-secret"] === segredo)
    );
    return {
      url,
      ativo: c.enabled !== false && Boolean(url),
      eventos: ((c.events as string[] | undefined) ?? []).map(String),
      temSegredo,
    };
  } catch {
    return null;
  }
}

function corpoDoWebhook(url: string) {
  return { enabled: true, url, byEvents: false, base64: false, events: ["MESSAGES_UPSERT"] };
}

export async function criarInstancia(nome: string, webhookUrl: string) {
  const r = await chamar("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: nome,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: corpoDoWebhook(webhookUrl),
    }),
  });
  if (!r.ok) return { ok: false as const, erro: erroDe(r) };
  const c = r.corpo as { qrcode?: { base64?: string } } | null;
  return { ok: true as const, qr: c?.qrcode?.base64 ?? null };
}

export async function qrParaConectar(nome: string) {
  const r = await chamar(`/instance/connect/${encodeURIComponent(nome)}`);
  if (!r.ok) return { ok: false as const, erro: erroDe(r) };
  const c = r.corpo as { base64?: string; pairingCode?: string; code?: string } | null;
  return { ok: true as const, qr: c?.base64 ?? null, codigo: c?.pairingCode ?? null };
}

export async function definirWebhook(nome: string, url: string) {
  const r = await chamar(`/webhook/set/${encodeURIComponent(nome)}`, {
    method: "POST",
    body: JSON.stringify({ webhook: corpoDoWebhook(url) }),
  });
  if (!r.ok) return { ok: false as const, erro: erroDe(r) };
  return { ok: true as const };
}

export async function desconectarInstancia(nome: string) {
  const r = await chamar(`/instance/logout/${encodeURIComponent(nome)}`, { method: "DELETE" });
  if (!r.ok) return { ok: false as const, erro: erroDe(r) };
  return { ok: true as const };
}
