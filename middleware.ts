import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas EXCETO:
     * - _next/static, _next/image (assets)
     * - favicon
     * - as rotas de servico, autenticadas por segredo proprio e nao por
     *   sessao: webhooks, cron e diagnostico de conversoes. Sem esta
     *   excecao elas levam 307 para /login e nunca executam - era o caso
     *   do cron de follow-ups, que chega sem cookie de sessao.
     * - arquivos estaticos comuns
     */
    "/((?!_next/static|_next/image|favicon.ico|api/webhook|api/cron|api/google/ads-status|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
