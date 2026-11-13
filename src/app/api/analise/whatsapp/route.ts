import { NextResponse, type NextRequest } from "next/server";
import {
  NOME_DA_INSTANCIA,
  estadoDaInstancia,
  listarInstancias,
  webhookDaInstancia,
} from "@/lib/evolution/instancias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostico das instancias da Evolution — somente leitura. Nao devolve
// chave nem token de instancia.
//
//   GET ?secret=...

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const segredo = process.env.WHATSAPP_WEBHOOK_SECRET;
  const { instancias, erro } = await listarInstancias();
  const papeis = await Promise.all(
    (["sdr", "closer"] as const).map(async (papel) => {
      const nome = NOME_DA_INSTANCIA[papel];
      const webhook = nome ? await webhookDaInstancia(nome, segredo) : null;
      return {
        papel,
        nome,
        estado: nome ? await estadoDaInstancia(nome) : "desconhecido",
        webhook: webhook && { ...webhook, url: webhook.url?.replace(/token=[^&]+/, "token=***") ?? null },
      };
    })
  );
  return NextResponse.json({
    chave_global_configurada: Boolean(process.env.EVOLUTION_GLOBAL_API_KEY),
    erro_ao_listar: erro ?? null,
    instancias,
    papeis,
  });
}
