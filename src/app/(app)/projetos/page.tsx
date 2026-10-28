import { createClient } from "@/lib/supabase/server";
import { ProjectList } from "@/components/delivery/ProjectList";
export default async function ProjectsPage() {
  const db = await createClient();
  const { data } = await db
    .from("leads")
    .select("id,nome")
    .order("nome")
    .limit(1000);
  return <ProjectList leads={data ?? []} />;
}
