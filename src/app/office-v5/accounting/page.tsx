"use client";

import { AccountingBoard } from "@/components/billing-v5/accounting-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";

export default function BillingV5AccountingPage() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return <AccountingBoard snapshot={snapshot} />;
}
