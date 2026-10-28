import {
  sessionUser,
  sameOrigin,
  readJson,
  failure,
} from "@/lib/delivery/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
export async function GET() {
  try {
    const { db } = await sessionUser();
    const { data, error } = await db
      .from("delivery_projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw Error("Módulo indisponível. Verifique a migration 0019.");
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { db, user } = await sessionUser();
    const input = z
      .object({
        name: z.string().trim().min(3).max(200),
        leadId: z.string().uuid(),
      })
      .strict()
      .parse(await readJson(req));
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("id", input.leadId)
      .single();
    if (!lead) throw Error("Lead indisponível");
    const { data, error } = await createAdminClient()
      .from("delivery_projects")
      .insert({ name: input.name, lead_id: input.leadId, owner_id: user.id })
      .select()
      .single();
    if (error) throw Error("Falha ao criar projeto");
    return Response.json(data);
  } catch (e) {
    return failure(e);
  }
}
