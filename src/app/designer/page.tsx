"use client";

import Link from "next/link";

import { ItemProductionAction } from "@/components/delivery";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, PageHeader, StatusDot, StatusPill } from "@/components/ui";
import {
  flowStatus,
  isOperationalRecord,
  isProductionComplete,
  priceState,
  sum,
} from "@/lib/derive";
import { longDate, money, todayIso } from "@/lib/format";
import type { BillingItem, FlowStatus } from "@/lib/types";

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
  // The three counts partition the queue, so they can be read as a whole.
  const inProgress = actionable.filter((item) => item.billingStatus !== "READY_TO_INVOICE");

  return (
    <div className="animate-rise">
      <PageHeader title={t("today.title")} subtitle={longDate(todayIso(), locale)} />

      <div className="grid grid-cols-3 gap-px overflow-hidden border-y border-line bg-line sm:mx-8 sm:rounded-2xl sm:border">
        <Stat
          label={t("status.NEEDS_REVIEW")}
          status="NEEDS_REVIEW"
          count={review.length}
          amount={sum(review)}
        />
        <Stat
          label={t("status.IN_PROGRESS")}
          status="IN_PROGRESS"
          count={inProgress.length}
          amount={sum(inProgress)}
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
              item={item}
              title={scope.idx.projectById.get(item.projectId)?.name ?? ""}
              client={scope.clientOf(item.projectId)?.name ?? ""}
              status="NEEDS_REVIEW"
            />
          ))}
        </Section>
      )}

      {actionable.length > 0 ? (
        <Section title={t("designer.today.deliver")} hint={t("designer.today.deliverHint")}>
          {actionable.map((item) => (
            <Row
              key={item.id}
              item={item}
              title={scope.idx.projectById.get(item.projectId)?.name ?? ""}
              client={scope.clientOf(item.projectId)?.name ?? ""}
              status={flowStatus(item)}
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
      {/* Wraps rather than truncates: the longer English labels do not fit on
          one line at 390 and a clipped "Ready to Inv…" reads as broken. */}
      <span className="flex items-start gap-1.5 text-[12px] leading-snug text-muted">
        <StatusDot status={status} className="mt-[5px]" />
        <span className="min-w-0">{label}</span>
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

/**
 * The queue reads project-first, because that is how the work is spoken about,
 * with the item underneath it. Same three column grid as the project lists, so
 * amounts line up across every screen in the workspace.
 */
function Row({
  item,
  title,
  client,
  status,
}: {
  item: BillingItem;
  title: string;
  client: string;
  status: FlowStatus;
}) {
  const { t } = useI18n();
  const state = priceState(item);
  const href = `/designer/projects/${item.projectId}?item=${encodeURIComponent(item.id)}`;
  const unconfirmed = state !== "CONFIRMED";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-4 sm:px-6">
      <StatusPill status={status} className="col-span-2 col-start-1 row-start-1 mb-2" />

      <Link href={`/designer/projects/${item.projectId}`} className="col-start-1 row-start-2 min-w-0">
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">{title}</span>
      </Link>

      <Amount
        value={item.amount > 0 ? money(item.amount) : "—"}
        className="col-start-2 row-start-2 justify-self-end text-[15px]"
      />

      <p className="col-start-1 row-start-3 mt-1 min-w-0 truncate text-[12.5px] text-muted">
        {client} · {item.description}
      </p>

      {unconfirmed && (
        <span className="col-start-2 row-start-3 mt-1 justify-self-end whitespace-nowrap text-[11.5px] font-medium text-review">
          {state === "PENDING"
            ? t("projects.pricePending")
            : t("projects.priceSuggestedShort")}
          {" · "}
          {t("projects.priceReview")}
        </span>
      )}

      <div className="col-span-2 col-start-1 row-start-4 mt-3 flex flex-wrap items-center justify-end gap-2">
        {unconfirmed && (
          <Link
            href={href}
            className="inline-flex h-9 min-w-[84px] shrink-0 items-center justify-center rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover"
          >
            {t("projects.reviewPrice")}
          </Link>
        )}
        <ItemProductionAction
          item={item}
          size="sm"
          variant={unconfirmed ? "secondary" : undefined}
        />
      </div>
    </div>
  );
}
