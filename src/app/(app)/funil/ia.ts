"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { proximoPassoDoLead, ultimaAnaliseDoLead } from "@/lib/ia/proximoPasso";

// A IA so roda quando o closer pede (botao no card). Abrir o card so le a
// ultima analise guardada, sem custo.
export async function ultimaAnalise(leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login de novo." };
  return ultimaAnaliseDoLead(createAdminClient(), leadId);
}

// Roda a IA agora (botao). "forcar" refaz mesmo sem novidade.
export async function proximoPasso(leadId: string, forcar = false) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login de novo." };
  return proximoPassoDoLead(createAdminClient(), leadId, forcar);
}
