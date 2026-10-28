import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliveryMcp } from "@/lib/delivery/mcp";
import { projectAccess } from "@/lib/delivery/service";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (
    origin &&
    origin !== new URL(req.url).origin &&
    origin !== "https://claude.ai"
  )
    return new Response("Forbidden", { status: 403 });
  const token = req.headers
    .get("authorization")
    ?.match(/^Bearer (sd_[a-f0-9]{64})$/)?.[1];
  if (!token) return new Response("Unauthorized", { status: 401 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("delivery_tokens")
    .select("project_id,user_id")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return new Response("Unauthorized", { status: 401 });
  try {
    await projectAccess(data.project_id, data.user_id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (raw.length > 2_000_000)
    return new Response("Payload too large", { status: 413 });
  const server = deliveryMcp(data.project_id, data.user_id),
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(
      new Request(req.url, { method: "POST", headers: req.headers, body: raw }),
    );
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await server.close();
  }
}
export async function GET() {
  return new Response("Use POST", { status: 405, headers: { Allow: "POST" } });
}
