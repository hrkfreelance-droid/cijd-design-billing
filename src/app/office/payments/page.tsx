"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { HistoricalRecordRow } from "@/components/historical-record-row";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { InvoiceListRow } from "@/components/invoice-list-row";
import { useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { EmptyState, PageHeader, PageTotal, Segmented } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { groupHistoricalItems, sortArchiveInvoices } from "@/lib/historical";
import { money } from "@/lib/format";
import type { Invoice } from "@/lib/types";

type Tab = "awaiting" | "receipts" | "completed";

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

  const awaiting = scope.invoices.filter((invoice) => invoice.status === "ISSUED");
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
  const shown = tab === "awaiting" ? awaiting : tab === "receipts" ? receipts : completed;
  const shownHistorical = tab === "completed" ? historical : [];
  const total =
    shown.reduce((value, invoice) => value + invoice.amount, 0) +
    shownHistorical.reduce((value, group) => value + group.amount, 0);
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
          <PageTotal
            value={money(total)}
            label={tab === "completed" ? t("projects.knownTotal") : undefined}
          />
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
      ) : (
        <div className="space-y-3 pb-10">
          {shown.length > 0 && (
            <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
              {shown.map((invoice) => (
                <InvoiceListRow key={invoice.id} invoice={invoice} onOpen={setOpen} />
              ))}
            </div>
          )}
          {shownHistorical.length > 0 && (
            <section>
              <h2 className="px-5 pb-2 text-[15px] font-semibold sm:px-8">
                {t("archive.historySection")}
              </h2>
              <div className="space-y-3 sm:px-8">
                {shownHistorical.map((group) => (
                  <HistoricalRecordRow key={group.projectId} group={group} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <InvoiceSheet invoice={open} onClose={() => setOpen(null)} />
    </div>
  );
}
