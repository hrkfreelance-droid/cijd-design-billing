"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { HistoricalRecordRow } from "@/components/historical-record-row";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { InvoiceListRow } from "@/components/invoice-list-row";
import { useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { EmptyState, PageHeader, Segmented } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { isHistoricalRecord } from "@/lib/derive";
import { formatKhr } from "@/lib/exchange-rate";
import {
  archiveInvoiceDate,
  groupHistoricalItems,
  latestHistoricalMonth,
  sortArchiveInvoices,
} from "@/lib/historical";
import { money } from "@/lib/format";
import type { HistoricalGroup } from "@/lib/historical";
import type { Invoice } from "@/lib/types";

type Tab = "awaiting" | "receipts" | "completed";

type CompletedEntry =
  | { kind: "invoice"; invoice: Invoice; sortDate: string }
  | { kind: "historical"; group: HistoricalGroup; sortDate: string };

export default function PaymentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Payments />
    </Suspense>
  );
}

function Payments() {
  const scope = useScope();
  const { t } = useI18n();
  const { user } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("awaiting");
  const [open, setOpen] = useState<Invoice | null>(null);

  const allowed = !!user && can(user.role, "payment:read");

  useEffect(() => {
    if (user && !allowed) router.replace("/office");
  }, [user, allowed, router]);

  if (!scope || !allowed) return <PageSkeleton />;

  const historicalInvoiceIds = new Set(
    scope.invoices
      .filter((invoice) => {
        const items = scope.idx.itemsByInvoice.get(invoice.id) ?? [];
        return items.length > 0 && items.every(isHistoricalRecord);
      })
      .map((invoice) => invoice.id),
  );
  const awaiting = scope.invoices.filter(
    (invoice) => invoice.status === "ISSUED" && !historicalInvoiceIds.has(invoice.id),
  );
  const receipts = scope.invoices.filter(
    (invoice) => invoice.status === "PAID" && invoice.receiptStatus === "PENDING",
  );
  const completed = sortArchiveInvoices(
    scope.invoices.filter(
      (invoice) => invoice.status === "PAID" && invoice.receiptStatus !== "PENDING",
    ),
  );
  const historical = groupHistoricalItems(
    scope.items,
    scope.idx.projectById,
    scope.idx.clientById,
  );
  const completedEntries: CompletedEntry[] = [
    ...completed.map((invoice) => ({
      kind: "invoice" as const,
      invoice,
      sortDate: archiveInvoiceDate(invoice),
    })),
    ...historical.map((group) => ({
      kind: "historical" as const,
      group,
      sortDate: latestHistoricalMonth(group),
    })),
  ].sort((a, b) => {
    const dateOrder = b.sortDate.localeCompare(a.sortDate);
    if (dateOrder) return dateOrder;
    if (a.kind === "invoice" && b.kind === "invoice") {
      return b.invoice.id.localeCompare(a.invoice.id);
    }
    if (a.kind === "historical" && b.kind === "historical") {
      return a.group.project.name.localeCompare(b.group.project.name);
    }
    return a.kind === "invoice" ? -1 : 1;
  });
  const shown = tab === "awaiting" ? awaiting : tab === "receipts" ? receipts : completed;
  const shownHistorical = tab === "completed" ? historical : [];
  const total =
    shown.reduce((value, invoice) => value + invoice.amount, 0) +
    shownHistorical.reduce((value, group) => value + group.amount, 0);
  const exchangeRate = scope.snapshot.exchangeRate;
  const emptyLabel =
    tab === "awaiting"
      ? t("billing.awaitingEmpty")
      : tab === "receipts"
        ? t("billing.receiptsEmpty")
        : t("office.completedEmpty");

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("office.payments")}
        subtitle={scope.client ? scope.client.name : t("client.all")}
        action={
          <div className="shrink-0 text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">
              {tab === "completed" ? t("projects.knownTotal") : t("common.total")}
            </p>
            <p className="tnum mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-text">
              {money(total)}
            </p>
            {exchangeRate ? (
              <p className="tnum mt-0.5 text-[11px] text-faint">≈{formatKhr(total, exchangeRate.rate)}</p>
            ) : null}
          </div>
        }
      />

      <div className="px-5 pb-5 sm:px-8">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "awaiting",
              label: t("billing.awaiting"),
              short: t("billing.awaitingShort"),
              count: awaiting.length,
            },
            {
              value: "receipts",
              label: t("billing.receipts"),
              short: t("billing.receiptsShort"),
              count: receipts.length,
            },
            {
              value: "completed",
              label: t("office.completed"),
              count: completed.length + historical.length,
            },
          ]}
          className="max-w-lg"
        />
      </div>

      {shown.length === 0 && shownHistorical.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : tab === "completed" ? (
        <div className="space-y-3 pb-10">
          {historical.length > 0 && (
            <h2 className="px-5 pb-2 text-[15px] font-semibold sm:px-8">
              {t("archive.historySection")}
            </h2>
          )}
          <div className="space-y-3 sm:px-8">
            {completedEntries.map((entry) =>
              entry.kind === "invoice" ? (
                <div
                  key={entry.invoice.id}
                  className="divide-y divide-line border-y border-line bg-panel sm:rounded-2xl sm:border"
                >
                  <InvoiceListRow invoice={entry.invoice} onOpen={setOpen} />
                </div>
              ) : (
                <HistoricalRecordRow key={entry.group.projectId} group={entry.group} />
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 pb-10">
          {shown.length > 0 && (
            <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
              {shown.map((invoice) => (
                <InvoiceListRow key={invoice.id} invoice={invoice} onOpen={setOpen} />
              ))}
            </div>
          )}
        </div>
      )}

      <InvoiceSheet invoice={open} onClose={() => setOpen(null)} />
    </div>
  );
}
