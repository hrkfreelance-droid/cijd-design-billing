"use client";

import { useMemo } from "react";

import { useI18n, useSession } from "@/components/providers";
import { EmptyState, PageHeader } from "@/components/ui";
import { PageSkeleton, useScope } from "@/components/scope";
import { can } from "@/lib/auth/roles";
import {
  isOperationalRecord,
  isProductionComplete,
  isPrintPriceConfirmed,
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

/**
 * A deliberately passive view for Billing and Accounting. It exposes the
 * same client → project → item hierarchy as Design, but has no links,
 * controls, notes, or audit metadata to accidentally operate. Amounts are
 * display-only evidence and never become an editing control here.
 */
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

  if (!scope || !user || !can(user.role, "progress:read")) return <PageSkeleton />;

  return (
    <div className="animate-rise" data-testid="progress-readonly">
      <PageHeader title={t("nav.progress")} subtitle={t("office.progressSubtitle")} />

      {groups.length === 0 ? (
        <EmptyState title={t("office.progressEmpty")} />
      ) : (
        <div className="space-y-6 pb-10">
          {groups.map((group) => (
            <section
              key={group.project.id}
              data-testid={`progress-project-${group.project.id}`}
              className="px-5 sm:px-8"
            >
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{group.client.name}</h2>
              <div className="mt-2 overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border">
                <div className="border-b border-line px-5 py-3.5 sm:px-6">
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <h3 className="min-w-0 truncate text-[15px] font-medium">{group.project.name}</h3>
                    <span className="shrink-0 text-[12px] text-faint">
                      {mediumDate(group.project.date, locale)}
                    </span>
                  </div>
                  <div className="mt-2 divide-y divide-line">
                    {group.items
                      .slice()
                      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                      .map((item) => (
                        <div
                          key={item.id}
                          data-testid={`progress-item-${item.id}`}
                          className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1 truncate text-[14px] text-text">
                            {itemLabel(item)}
                          </span>
                          <span className="tnum shrink-0 text-[13.5px] font-medium text-text">
                            {itemAmount(item)}
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${STATE_STYLE[progressState(item)]}`}>
                            {t(STATE_KEY[progressState(item)])}
                          </span>
                        </div>
                      ))}
                  </div>
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
  if (/\bprint(?:ing)?\b\s+(?:[x×]\s*)?\d+\b/i.test(item.description)) {
    return item.description;
  }
  if (/\b[x×]\s*\d+\b/i.test(item.description)) return item.description;
  return `${item.description} ×${item.quantity}`;
}

/** Show known current or suggested money without implying price certainty. */
function itemAmount(item: BillingItem): string {
  const values =
    item.type === "PRINT" && !isPrintPriceConfirmed(item)
      ? [item.suggestedAmount, item.amount]
      : [item.amount, item.suggestedAmount];
  const amount = values.find((value): value is number => value != null && value > 0);
  return amount == null ? "—" : money(amount);
}
