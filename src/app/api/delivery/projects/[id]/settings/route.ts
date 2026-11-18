import { randomBytes, createHash } from "node:crypto";
import {
  sessionUser,
  sameOrigin,
  readJson,
  failure,
} from "@/lib/delivery/http";
import { projectAccess } from "@/lib/delivery/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const { user } = await sessionUser(),
      { id } = await params,
      p = await projectAccess(id, user.id),
      db = createAdminClient();
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("token") }),
        z.object({ action: z.literal("revoke"), tokenId: z.string().uuid() }),
        z.object({
          action: z.literal("repository"),
          repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
        }),
        z.object({ action: z.literal("member"), userId: z.string().uuid() }),
      ])
      .parse(await readJson(req));
    if (input.action === "token") {
      const token = "sd_" + randomBytes(32).toString("hex");
      const { error } = await db
        .from("delivery_tokens")
        .insert({
          project_id: null,
          user_id: user.id,
          token_hash: createHash("sha256").update(token).digest("hex"),
          expires_at: null,
        });
      if (error) throw Error("Falha ao criar conexão");
      return Response.json(
        { token, expiresAt: null, projectId: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (input.action === "revoke") {
      const { error } = await db
        .from("delivery_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", input.tokenId)
        .eq("user_id", user.id);
      if (error) throw Error("Falha ao revogar");
    } else {
      if (p.owner_id !== user.id)
        throw Error("Somente responsável pelo projeto");
      if (input.action === "repository") {
        const { error } = await db
          .from("delivery_projects")
          .update({ repository: input.repository })
          .eq("id", id);
        if (error) throw Error("Falha ao vincular repositório");
      }
      if (input.action === "member") {
        const { error } = await db
          .from("delivery_members")
          .upsert({ project_id: id, user_id: input.userId });
        if (error)
          throw Error("Usuário inexistente ou falha ao adicionar membro");
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
