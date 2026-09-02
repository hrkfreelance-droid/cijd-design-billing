"use client";

import { useMemo } from "react";

import { CompactSummaryHeader } from "@/components/compact-summary-header";
import { useI18n, useSession } from "@/components/providers";
import { Amount, EmptyState } from "@/components/ui";
import { PageSkeleton, useScope } from "@/components/scope";
import { can } from "@/lib/auth/roles";
import {
  isOperationalRecord,
  isProductionComplete,
  isPrintPriceConfirmed,
  priceState,
  sum,
} from "@/lib/derive";
import { mediumDate, money } from "@/lib/format";
import type { BillingItem, Client, Project } from "@/lib/types";

type ProgressState =
  | "inProgress"
  | "priceReview"
  | "printing"
  | "completed"
  | "delivered"
  | "ready"
  | "invoiced"
  | "paid";

const STATE_STYLE: Record<ProgressState, string> = {
  inProgress: "bg-fill text-muted",
  priceReview: "bg-review/10 text-review",
  printing: "bg-fill text-muted",
  completed: "bg-paid/10 text-paid",
  delivered: "bg-ready/10 text-ready",
  ready: "bg-ready/10 text-ready",
  invoiced: "bg-awaiting/10 text-awaiting",
  paid: "bg-paid/10 text-paid",
};

const STATE_KEY: Record<ProgressState, Parameters<ReturnType<typeof useI18n>["t"]>[0]> = {
  inProgress: "progress.inProgress",
  priceReview: "progress.priceReview",
  printing: "progress.printing",
  completed: "progress.completed",
  delivered: "progress.delivered",
  ready: "progress.ready",
  invoiced: "progress.invoiced",
  paid: "progress.paid",
};

interface ProjectGroup {
  client: Client;
  project: Project;
  items: BillingItem[];
}

/** Passive operational progress for Billing/Admin. */
export default function ProgressPage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const { user } = useSession();

  const groups = useMemo<ProjectGroup[]>(() => {
    if (!scope) return [];

    const byProject = new Map<string, ProjectGroup>();
    for (const item of scope.items) {
      if (!isOperationalRecord(item)) continue;
      const project = scope.idx.projectById.get(item.projectId);
      if (!project) continue;
      const client = scope.idx.clientById.get(project.clientId);
      if (!client) continue;
      const existing = byProject.get(project.id);
      if (existing) existing.items.push(item);
      else byProject.set(project.id, { client, project, items: [item] });
    }

    return Array.from(byProject.values()).sort((a, b) => {
      const clientOrder = a.client.name.localeCompare(b.client.name);
      if (clientOrder !== 0) return clientOrder;
      return b.project.date.localeCompare(a.project.date) || a.project.name.localeCompare(b.project.name);
    });
  }, [scope]);

  const progressItems = groups.flatMap((group) => group.items);
  const knownTotal = sum(progressItems.map((item) => ({ amount: itemAmountValue(item) ?? 0 })));
  const pendingCount = progressItems.filter((item) => itemAmountValue(item) == null).length;
  const estimated = progressItems.some((item) => priceState(item) !== "CONFIRMED");

  if (!scope || !user || !can(user.role, "progress:read")) return <PageSkeleton />;

  return (
    <div className="animate-rise" data-testid="progress-readonly">
      <CompactSummaryHeader
        title={t("nav.progress")}
        subtitle={t("office.progressSubtitle")}
        label={t(estimated ? "projects.estimatedTotal" : "projects.total")}
        value={knownTotal > 0 ? money(knownTotal) : "—"}
        meta={
          pendingCount > 0
            ? pendingCount === 1
              ? t("projects.pendingPricesOne", { count: pendingCount })
              : t("projects.pendingPrices", { count: pendingCount })
            : undefined
        }
      />

      {groups.length === 0 ? (
        <EmptyState title={t("office.progressEmpty")} />
      ) : (
        <div className="space-y-3 px-5 pb-10 sm:px-8">
          {groups.map((group) => (
            <section
              key={group.project.id}
              data-testid={`progress-project-${group.project.id}`}
              className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border"
            >
              <div className="border-b border-line px-5 py-2 sm:px-6">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-[17px] font-semibold tracking-[-0.012em]">{group.project.name}</h2>
                    <p className="mt-1 truncate text-[12.5px] text-faint">
                      {group.client.name} · {mediumDate(group.project.date, locale)}
                    </p>
                  </div>
                  <ProgressProjectTotal items={group.items} />
                </div>
                <div className="mt-2 divide-y divide-line">
                  {group.items
                    .slice()
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                    .map((item) => (
                      <div
                        key={item.id}
                        data-testid={`progress-item-${item.id}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5 first:pt-0 last:pb-0"
                      >
                        <span className="min-w-0 truncate text-[14px] text-text">{itemLabel(item)}</span>
                        <Amount
                          value={itemAmountValue(item) == null ? "—" : money(itemAmountValue(item)!)}
                          className="shrink-0 text-[13.5px] font-medium text-text"
                        />
                        <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${STATE_STYLE[progressState(item)]}`}>
                          {t(STATE_KEY[progressState(item)])}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function progressState(item: BillingItem): ProgressState {
  if (item.billingStatus === "PAID") return "paid";
  if (item.billingStatus === "INVOICED") return "invoiced";
  if (item.billingStatus === "READY_TO_INVOICE") return "ready";
  if (item.type === "PRINT" && !isPrintPriceConfirmed(item)) return "priceReview";
  if (item.billingStatus === "NEEDS_REVIEW") return "priceReview";
  if (item.productionStatus === "DELIVERED") return "delivered";
  if (item.productionStatus === "COMPLETED") return "completed";
  if (item.type === "PRINT" && isProductionComplete(item)) return "printing";
  return "inProgress";
}

function itemLabel(item: BillingItem): string {
  if (item.type !== "PRINT") return item.description;
  if (/\bprint(?:ing)?\b\s+(?:[x×]\s*)?\d+\b/i.test(item.description)) return item.description;
  if (/\b[x×]\s*\d+\b/i.test(item.description)) return item.description;
  return `${item.description} ×${item.quantity}`;
}

function ProgressProjectTotal({ items }: { items: BillingItem[] }) {
  const { t } = useI18n();
  const total = items.reduce((amount, item) => amount + (itemAmountValue(item) ?? 0), 0);
  const estimated = items.some((item) => priceState(item) !== "CONFIRMED");
  return (
    <div className="shrink-0 text-right">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
        {t(estimated ? "projects.estimatedTotal" : "projects.total")}
      </p>
      <Amount value={total > 0 ? money(total) : "—"} strong className="mt-0.5 block text-[15px]" />
    </div>
  );
}

function itemAmountValue(item: BillingItem): number | null {
  const values =
    item.type === "PRINT" && !isPrintPriceConfirmed(item)
      ? [item.suggestedAmount, item.amount]
      : [item.amount, item.suggestedAmount];
  const amount = values.find((value): value is number => value != null && value > 0);
  return amount == null ? null : amount;
}
