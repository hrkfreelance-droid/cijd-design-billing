import { ProjectsWorkspace } from "@/components/billing-v5/projects-workspace";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectsWorkspace id={id} />;
}
