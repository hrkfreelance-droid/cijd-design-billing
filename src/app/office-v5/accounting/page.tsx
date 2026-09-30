"use client";

import { Suspense } from "react";

import { AccountingBoard } from "@/components/billing-v5/accounting-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";

export default function BillingV5AccountingPage() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  // The view (to invoice / invoices / customers / products) lives in the URL.
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <AccountingBoard snapshot={snapshot} />
    </Suspense>
  );
}
