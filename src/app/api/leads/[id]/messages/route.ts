import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/leads/:id/messages
// Usado pelo poll da conversa. Autenticado via cookie de sessao (RLS).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("lead_messages")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  return NextResponse.json(
    { messages: data ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
