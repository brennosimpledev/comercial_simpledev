import {
  sessionUser,
  sameOrigin,
  readJson,
  failure,
} from "@/lib/delivery/http";
import { projectBundle, writeProject } from "@/lib/delivery/service";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, c: Context) {
  try {
    const { user } = await sessionUser();
    return Response.json(await projectBundle((await c.params).id, user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, c: Context) {
  try {
    sameOrigin(req);
    const { user } = await sessionUser();
    return Response.json(
      await writeProject((await c.params).id, user.id, await readJson(req)),
    );
  } catch (e) {
    return failure(e);
  }
}
