"use client";

import { BillingBoard } from "@/components/billing-v2/billing-board";
import { BoardSkeleton } from "@/components/billing-v2/v2-shell";
import { useData } from "@/components/providers";

export default function BillingV2Page() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return <BillingBoard snapshot={snapshot} />;
}
