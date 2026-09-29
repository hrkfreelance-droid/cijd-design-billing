"use client";

import { BillingV3Board } from "@/components/billing-v3/billing-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";

/** The designer's screen is V3's, unchanged. */
export default function BillingV5Page() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return <BillingV3Board snapshot={snapshot} />;
}
