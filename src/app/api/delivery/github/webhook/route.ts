import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature, reconcileProject } from "@/lib/delivery/github";
export const maxDuration = 60;
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 2_000_000) return new Response("Too large", { status: 413 });
  if (
    !validSignature(
      raw,
      req.headers.get("x-hub-signature-256"),
      process.env.DELIVERY_GITHUB_WEBHOOK_SECRET ?? "",
    )
  )
    return new Response("Unauthorized", { status: 401 });
  const delivery = req.headers.get("x-github-delivery");
  if (!delivery || delivery.length > 100)
    return new Response("Missing delivery ID", { status: 400 });
  if (
    ![
      "issues",
      "pull_request",
      "check_run",
      "check_suite",
      "deployment_status",
    ].includes(req.headers.get("x-github-event") ?? "")
  )
    return Response.json({ ignored: true });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (typeof payload.repository?.full_name !== "string")
    return new Response("Missing repository", { status: 400 });
  const db = createAdminClient();
  const { data: seen } = await db
    .from("delivery_webhooks")
    .select("delivery_id")
    .eq("delivery_id", delivery)
    .maybeSingle();
  if (seen) return Response.json({ duplicate: true });
  const { data: projects, error } = await db
    .from("delivery_projects")
    .select("id")
    .eq("repository", payload.repository.full_name);
  if (error) return new Response("Unavailable", { status: 503 });
  try {
    for (const p of projects ?? []) await reconcileProject(p.id);
    const { error: save } = await db
      .from("delivery_webhooks")
      .upsert({ delivery_id: delivery });
    if (save) throw save;
    return Response.json({ ok: true });
  } catch {
    return new Response("Sync failed; retry or reconcile", { status: 503 });
  }
}
