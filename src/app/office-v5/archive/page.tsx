"use client";

import { useMemo } from "react";

import { ArchiveBoard } from "@/components/billing-v2/archive-board";
import { InvoiceList } from "@/components/billing-v5/invoice-list";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";
import { useV5T } from "@/lib/billing-v5/i18n";

const isSampleName = (name: string) => /^(TEST\b|ZZ\b|QA\b|Test$|test$|てst$)/i.test(name.trim());

export default function BillingV5ArchivePage() {
  const { snapshot } = useData();
  const t = useV5T();

  const excludedProjectIds = useMemo(() => {
    if (!snapshot) return new Set<string>();
    const ids = new Set<string>();

    // V5 invoices are represented by the invoice row itself: while unpaid they
    // belong in Accounting; when fully paid InvoiceList shows them here.
    for (const invoice of snapshot.taxInvoices ?? []) {
      if (invoice.status !== "ISSUED" || invoice.invoiceNumber.startsWith("TEST")) continue;
      for (const id of invoice.projectIds?.length ? invoice.projectIds : [invoice.projectId]) {
        if (id) ids.add(id);
      }
    }

    // Test/QA records are not business history. Keep them out of the working UI
    // even if an old test run left a billed row behind.
    const sampleClients = new Set(snapshot.clients.filter((client) => isSampleName(client.name)).map((client) => client.id));
    for (const project of snapshot.projects) {
      if (sampleClients.has(project.clientId) || isSampleName(project.name)) ids.add(project.id);
    }
    return ids;
  }, [snapshot]);

  if (!snapshot) return <BoardSkeleton />;

  return (
    <ArchiveBoard
      snapshot={snapshot}
      excludeProjectIds={excludedProjectIds}
      allowRestore={false}
      leading={
        <div className="px-5 sm:px-8">
          <InvoiceList
            snapshot={snapshot}
            compact
            mode="completed"
            excludeTest
            compactTitle={t("archive.completedInvoices")}
          />
        </div>
      }
    />
  );
}
