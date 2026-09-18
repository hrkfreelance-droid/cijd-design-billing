"use client";

import { BillingV3Board } from "@/components/billing-v3/billing-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";

export default function BillingV3Page() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return (
    <>
      <span className="sr-only" data-v3-pricing-mode="qty-unit">
        V3 pricing: Quantity and Unit Cost are manual; Total Cost equals Quantity times Unit Cost.
      </span>
      <BillingV3Board snapshot={snapshot} />
    </>
  );
}
