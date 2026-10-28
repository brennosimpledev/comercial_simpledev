import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileProject } from "@/lib/delivery/github";
export const maxDuration = 60;
export async function GET(req: Request) {
  const expected = process.env.DELIVERY_CRON_SECRET,
    actual = req.headers.get("authorization");
  if (
    !expected ||
    !actual ||
    actual.length !== `Bearer ${expected}`.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`))
  )
    return new Response("Unauthorized", { status: 401 });
  const { data, error } = await createAdminClient()
    .from("delivery_projects")
    .select("id")
    .not("repository", "is", null)
    .order("id")
    .limit(11);
  if (error) return new Response("Unavailable", { status: 503 });
  // Explicit project parameter lets an external scheduler batch large portfolios.
  const selected = new URL(req.url).searchParams.get("project");
  if (!selected && (data?.length ?? 0) > 10)
    return new Response(
      "Schedule per-project reconciliation for portfolios over 10 projects",
      { status: 400 },
    );
  const ids = selected ? [selected] : (data ?? []).map((p) => p.id);
  const results = [];
  for (const id of ids) {
    try {
      results.push({ id, ...(await reconcileProject(id)) });
    } catch {
      results.push({ id, error: "Falha na sincronização" });
    }
  }
  return Response.json(
    { results },
    { status: results.some((r) => "error" in r) ? 503 : 200 },
  );
}
