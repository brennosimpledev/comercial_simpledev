import { ProjectWorkspace } from "@/components/delivery/ProjectWorkspace";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ProjectWorkspace id={(await params).id} />;
}
