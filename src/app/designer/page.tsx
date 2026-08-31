"use client";

import Link from "next/link";

import { ItemProductionAction } from "@/components/delivery";
import { ChevronRight } from "@/components/icons";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, PageHeader, StatusDot, StatusTag } from "@/components/ui";
import { flowStatus, isOperationalRecord, isProductionComplete, sum } from "@/lib/derive";
import { longDate, money, todayIso } from "@/lib/format";
import type { FlowStatus } from "@/lib/types";

export default function DesignerTodayPage() {
  const scope = useScope();
  const { t, locale } = useI18n();

  if (!scope) return <PageSkeleton />;

  const currentWork = scope.items.filter(
    (item) => isOperationalRecord(item) && !isProductionComplete(item),
  );
  const review = currentWork.filter((item) => item.billingStatus === "NEEDS_REVIEW");
  const ready = currentWork.filter((item) => item.billingStatus === "READY_TO_INVOICE");
  const actionable = currentWork.filter((item) => item.billingStatus !== "NEEDS_REVIEW");

  return (
    <div className="animate-rise">
      <PageHeader title={t("today.title")} subtitle={longDate(todayIso(), locale)} />

      <div className="grid grid-cols-3 gap-px overflow-hidden border-y border-line bg-line sm:mx-8 sm:rounded-2xl sm:border">
        <Stat
          label={t("status.IN_PROGRESS")}
          status="IN_PROGRESS"
          count={currentWork.length}
          amount={sum(currentWork)}
        />
        <Stat
          label={t("status.NEEDS_REVIEW")}
          status="NEEDS_REVIEW"
          count={review.length}
          amount={sum(review)}
        />
        <Stat
          label={t("status.READY_TO_INVOICE")}
          status="READY_TO_INVOICE"
          count={ready.length}
          amount={sum(ready)}
        />
      </div>

      {review.length > 0 && (
        <Section title={t("today.review")} hint={t("today.reviewHint")}>
          {review.map((item) => (
            <Row
              key={item.id}
              projectId={item.projectId}
              title={scope.idx.projectById.get(item.projectId)?.name ?? ""}
              meta={`${scope.clientOf(item.projectId)?.name ?? ""} · ${item.description}`}
              amount={item.amount > 0 ? money(item.amount) : "—"}
              status="NEEDS_REVIEW"
              action={<ItemProductionAction item={item} size="sm" />}
            />
          ))}
      </Section>
      )}

      {actionable.length > 0 ? (
        <Section title={t("designer.today.deliver")} hint={t("designer.today.deliverHint")}>
          {actionable.map((item) => (
            <Row
              key={item.id}
              projectId={item.projectId}
              title={scope.idx.projectById.get(item.projectId)?.name ?? ""}
              meta={`${scope.clientOf(item.projectId)?.name ?? ""} · ${item.description}`}
              amount={item.amount > 0 ? money(item.amount) : "—"}
              status={flowStatus(item)}
              action={<ItemProductionAction item={item} size="sm" />}
            />
          ))}
        </Section>
      ) : (
        review.length === 0 && (
          <EmptyState title={t("designer.today.empty")} hint={t("designer.today.emptyHint")} />
        )
      )}

    </div>
  );
}

function Stat({
  label,
  status,
  count,
  amount,
}: {
  label: string;
  status: FlowStatus;
  count: number;
  amount: number;
}) {
  const dim = count === 0;
  return (
    <div className="flex flex-col gap-1 bg-panel px-5 py-4 sm:py-5">
      <span className="flex items-center gap-1.5 text-[12px] text-muted">
        <StatusDot status={status} />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={`tnum text-[26px] font-semibold leading-none tracking-[-0.02em] ${dim ? "text-faint" : ""}`}
      >
        {count}
      </span>
      <span className={`tnum text-[12.5px] ${dim ? "text-faint" : "text-muted"}`}>
        {money(amount)}
      </span>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="px-5 pb-2 pt-8 sm:px-8">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="mt-0.5 text-[12.5px] text-faint">{hint}</p>
      </div>
      <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
        {children}
      </div>
    </section>
  );
}

function Row({
  projectId,
  title,
  meta,
  amount,
  status,
  action,
}: {
  projectId: string;
  title: string;
  meta: string;
  amount: string;
  status: FlowStatus;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
      <StatusTag status={status} className="shrink-0" />
      <Link href={`/designer/projects/${projectId}`} className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">{title}</span>
        <span className="mt-0.5 flex items-center gap-2 truncate text-[12.5px] text-faint">
          {meta}
        </span>
      </Link>
      <Amount value={amount} className="text-[15px]" />
      {action ?? (
        <Link href={`/designer/projects/${projectId}`} aria-hidden>
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
        </Link>
      )}
    </div>
  );
}
