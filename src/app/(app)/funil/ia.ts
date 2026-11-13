"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { proximoPassoDoLead } from "@/lib/ia/proximoPasso";

// Proximo passo do lead sugerido pela IA (card do Funil). Reaproveita a
// ultima analise quando nada mudou; "forcar" refaz na hora.
export async function proximoPasso(leadId: string, forcar = false) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login de novo." };
  return proximoPassoDoLead(createAdminClient(), leadId, forcar);
}
