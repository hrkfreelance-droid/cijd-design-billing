import { redirect } from "next/navigation";

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const params = new URLSearchParams({ status: "completed" });
  if (q) params.set("q", q);
  redirect(`/office-v5/projects?${params}`);
}
