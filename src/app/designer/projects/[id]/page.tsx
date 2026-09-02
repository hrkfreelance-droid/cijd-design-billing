"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { BillingItemCard } from "@/components/billing-item-card";
import { ChevronRight } from "@/components/icons";
import { ProjectEditorModal } from "@/components/project-editor-modal";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, PageHeader } from "@/components/ui";
import { isHistoricalRecord, sum } from "@/lib/derive";
import { mediumDate, money } from "@/lib/format";

/**
 * Legacy deep links still land here, but operational editing uses the same
 * focused ProjectEditorModal as the main Projects queue. This removes the old
 * duplicate editor that had drifted from the DAISHIN-style workflow and print
 * cost rules. Historical imports remain read-only.
 */
export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const scope = useScope();
  const { t, locale } = useI18n();
  const historyView = searchParams.get("view") === "history";
  const readyView = searchParams.get("from") === "ready";

  if (!scope) return <PageSkeleton />;

  const project = scope.idx.projectById.get(params.id);
  if (!project) {
    return (
      <div className="px-5 pt-16 text-center sm:px-8">
        <p className="text-[14px] text-muted">{t("project.notFound")}</p>
        <Link href="/designer/projects" className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline">
          {t("projects.title")}
        </Link>
      </div>
    );
  }

  if (!historyView) {
    const backHref = readyView ? "/designer/delivered" : "/designer/projects";
    return (
      <ProjectEditorModal
        projectId={project.id}
        open
        onClose={() => router.push(backHref)}
      />
    );
  }

  const client = scope.idx.clientById.get(project.clientId);
  const items = (scope.idx.itemsByProject.get(project.id) ?? [])
    .filter(isHistoricalRecord)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const total = sum(items.filter((item) => item.amount > 0));

  return (
    <div className="animate-rise">
      <div className="px-5 pt-3 sm:px-8 sm:pt-5">
        <Link href="/designer/archive" className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-text">
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
          {t("productionArchive.title")}
        </Link>
      </div>

      <PageHeader
        title={project.name}
        subtitle={`${client?.name ?? ""} · ${mediumDate(project.date, locale)}`}
        action={<Amount value={total > 0 ? money(total) : "—"} strong className="text-[20px]" />}
      />

      <p className="px-5 pb-2 text-[12.5px] leading-relaxed text-faint sm:px-8">
        {t("productionArchive.historyNotice")}
      </p>

      <div className="divide-y divide-line border-y border-line bg-panel px-5 sm:mx-8 sm:rounded-2xl sm:border sm:px-6">
        {items.map((item) => (
          <BillingItemCard key={item.id} item={item} projectId={project.id} history showActions={false} />
        ))}
        {items.length === 0 && (
          <div className="py-10 text-center text-[14px] text-muted">{t("project.noItems")}</div>
        )}
      </div>
    </div>
  );
}
