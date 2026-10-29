"use server";

import { createClient } from "@/lib/supabase/server";
import { montarContinuidade } from "@/lib/bot/continuidade";

// Rascunho da proxima mensagem do vendedor, a partir do que o cliente ja
// contou ao bot. Nada e enviado: quem revisa e envia e o vendedor.
// "retomada" e para o lead que conversou e parou de responder.
export async function gerarContinuidade(leadId: string, modo?: "retomada") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };
  return montarContinuidade(supabase, leadId, undefined, modo);
}
