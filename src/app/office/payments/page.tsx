"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { InvoiceSheet } from "@/components/invoice-sheet";
import { ChevronRight } from "@/components/icons";
import { useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, PageHeader, PageTotal, Segmented } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { mediumDate, money } from "@/lib/format";
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
  const completed = scope.invoices.filter(
    (invoice) => invoice.status === "PAID" && invoice.receiptStatus !== "PENDING",
  );
  const shown = tab === "awaiting" ? awaiting : tab === "receipts" ? receipts : completed;
  const total = shown.reduce((value, invoice) => value + invoice.amount, 0);
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
        action={<PageTotal value={money(total)} />}
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
              count: completed.length,
            },
          ]}
          className="max-w-lg"
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
          {shown.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} onOpen={setOpen} />
          ))}
        </div>
      )}

      <InvoiceSheet invoice={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function InvoiceRow({
  invoice,
  onOpen,
}: {
  invoice: Invoice;
  onOpen: (invoice: Invoice) => void;
}) {
  const scope = useScope();
  const { locale } = useI18n();
  return (
    <button
      onClick={() => onOpen(invoice)}
      className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-fill active:bg-fill sm:px-6"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
          {invoice.invoiceNumber ?? "Unknown"}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-faint">
          {scope?.idx.clientById.get(invoice.clientId)?.name} ·{" "}
          {mediumDate(invoice.invoiceDate, locale)}
        </span>
      </span>
      <Amount value={money(invoice.amount)} className="text-[15px]" />
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  );
}
