import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/leads/:id/closer-messages
// Conversa do lead no WhatsApp do closer, para o chat do Funil. closer_messages
// nao tem policy: le com a service role depois de conferir o login.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from("closer_messages")
    .select("id, lead_id, direction, body, media_type, wa_message_id, sent_at")
    .eq("lead_id", id)
    .order("sent_at", { ascending: true })
    .limit(1000);

  if (error) {
    // 42P01: a migration 0022 ainda nao rodou.
    const semTabela = error.code === "42P01";
    return NextResponse.json(
      { error: semTabela ? "Falta rodar a migration 0022_closer_messages.sql no Supabase." : "query failed" },
      { status: semTabela ? 503 : 500 }
    );
  }
  return NextResponse.json({ messages: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
