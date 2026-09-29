"use client";

import { ArchiveBoard } from "@/components/billing-v2/archive-board";
import { TaxInvoiceList } from "@/components/billing-v5/accounting-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";

export default function BillingV5ArchivePage() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return (
    <>
      <ArchiveBoard snapshot={snapshot} />
      <div className="px-5 pb-16 sm:px-8">
        <TaxInvoiceList snapshot={snapshot} />
      </div>
    </>
  );
}
