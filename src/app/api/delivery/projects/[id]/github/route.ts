import { sessionUser, sameOrigin, failure } from "@/lib/delivery/http";
import { projectAccess } from "@/lib/delivery/service";
import { reconcileProject } from "@/lib/delivery/github";
export const maxDuration = 60;
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const { user } = await sessionUser(),
      { id } = await params;
    await projectAccess(id, user.id);
    return Response.json(await reconcileProject(id));
  } catch (e) {
    return failure(e);
  }
}
