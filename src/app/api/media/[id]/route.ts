import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMediaBase64 } from "@/lib/evolution/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/media/:id  -> baixa a midia da mensagem via Evolution (sob demanda).
// Autenticado por cookie de sessao.
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

  const { data: msg } = await supabase
    .from("lead_messages")
    .select("raw, media_type")
    .eq("id", id)
    .single();

  if (!msg?.raw) {
    return NextResponse.json({ error: "sem mídia" }, { status: 404 });
  }

  const media = await getMediaBase64(msg.raw);
  if (!media) {
    return NextResponse.json({ error: "mídia indisponível" }, { status: 502 });
  }

  const buffer = Buffer.from(media.base64, "base64");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": media.mimetype,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
