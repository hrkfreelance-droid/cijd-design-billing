"use client";

import { ChevronRight } from "@/components/icons";
import { CurrencyAmount } from "@/components/currency-amount";
import { useI18n } from "@/components/providers";
import { useScope } from "@/components/scope";
import { archiveInvoiceDate } from "@/lib/historical";
import { mediumDate } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export function InvoiceListRow({
  invoice,
  onOpen,
}: {
  invoice: Invoice;
  onOpen: (invoice: Invoice) => void;
}) {
  const scope = useScope();
  const { t, locale } = useI18n();

  if (!scope) return null;

  const projectNames = Array.from(
    new Set(
      (scope.idx.itemsByInvoice.get(invoice.id) ?? [])
        .map((item) => scope.idx.projectById.get(item.projectId)?.name?.trim() ?? "")
        .filter(Boolean),
    ),
  );
  const invoiceNumber = invoice.invoiceNumber?.trim() ?? "";
  const clientName = scope.idx.clientById.get(invoice.clientId)?.name?.trim() ?? "";
  const date = mediumDate(archiveInvoiceDate(invoice), locale);
  const meta = [clientName, date].filter(Boolean).join(" · ");
  const projectTitle =
    projectNames.length === 0
      ? clientName
      : projectNames.length === 1
        ? projectNames[0]
        : `${projectNames[0]} ${
            projectNames.length === 2
              ? t("archive.moreProject")
              : t("archive.moreProjects", { count: projectNames.length - 1 })
          }`;

  return (
    <button
      onClick={() => onOpen(invoice)}
      className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-fill active:bg-fill sm:px-6"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
          {projectTitle}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
          {meta}
        </span>
        {invoiceNumber && (
          <span className="mt-0.5 block truncate text-[11px] text-faint">
            {invoiceNumber}
          </span>
        )}
      </span>
      <CurrencyAmount
        usd={invoice.amount}
        rate={invoice.exchangeRate}
        className="text-[15px]"
      />
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  );
}
