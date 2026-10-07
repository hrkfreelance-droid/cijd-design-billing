"use client";

import { useMemo, useState } from "react";

import { ArchiveBoard } from "@/components/billing-v2/archive-board";
import { InvoiceList } from "@/components/billing-v5/invoice-list";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";
import { useV5T } from "@/lib/billing-v5/i18n";

import { Select } from "@/components/ui";
import { workSnapshot, workLabel } from "@/lib/billing-v5/work-types";
import type { WorkType } from "@/lib/types";

const isSampleName = (name: string) => /^(TEST\b|ZZ\b|QA\b|Test$|test$|てst$)/i.test(name.trim());

export default function BillingV5ArchivePage() {
  const { snapshot } = useData();
  const t = useV5T();
  const [type, setType] = useState<WorkType | "ALL" | "SHARED">("DESIGN");

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

  const categories = type === "ALL" ? ["DESIGN", "OTHER_BUSINESS", "SHARED"] as const : [type];
  return <div>
    <label className="flex flex-wrap items-center gap-2 px-5 pt-6 text-[13px] text-muted sm:px-8">Archive:
      <Select aria-label="Archive work type" data-testid="v5-archive-type" value={type} onChange={e => setType(e.target.value as typeof type)}>
        <option value="DESIGN">Design</option><option value="OTHER_BUSINESS">Other Business</option>
        <option value="SHARED">Shared / multiple categories</option><option value="ALL">All</option>
      </Select>
    </label>
    {categories.map(category => {
      const scoped = workSnapshot(snapshot, category);
      return <section key={category} data-testid={`v5-archive-category-${category}`}>
        <h2 className="px-5 pt-6 text-[20px] font-semibold sm:px-8">{category === "SHARED" ? "Shared / multiple categories" : workLabel(category)}</h2>
        <ArchiveBoard snapshot={scoped} excludeProjectIds={excludedProjectIds} allowRestore={false}
          leading={<div className="px-5 sm:px-8"><InvoiceList snapshot={scoped} compact mode="completed" excludeTest compactTitle={t("archive.completedInvoices")} /></div>} />
      </section>;
    })}
  </div>;
}
