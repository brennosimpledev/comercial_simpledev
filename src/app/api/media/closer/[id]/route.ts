import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { midiaDoCloser } from "@/lib/evolution/closer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/media/closer/:id -> midia de uma mensagem do WhatsApp do closer,
// baixada da Evolution sob demanda.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: msg } = await createAdminClient()
    .from("closer_messages")
    .select("wa_message_id, media_type")
    .eq("id", id)
    .maybeSingle();
  if (!msg?.wa_message_id || !msg.media_type) {
    return NextResponse.json({ error: "sem mídia" }, { status: 404 });
  }

  const media = await midiaDoCloser(msg.wa_message_id as string);
  if (!media) return NextResponse.json({ error: "mídia indisponível" }, { status: 502 });

  return new Response(new Uint8Array(Buffer.from(media.base64, "base64")), {
    headers: { "Content-Type": media.mimetype, "Cache-Control": "private, max-age=86400" },
  });
}
