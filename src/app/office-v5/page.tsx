"use client";

import { BillingV3Board } from "@/components/billing-v3/billing-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";
import { workSnapshot } from "@/lib/billing-v5/work-types";

export default function BillingV5Page() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  const design = workSnapshot(snapshot, "DESIGN");
  return <BillingV3Board snapshot={{...design,projects:design.projects.filter(p=>p.billingDisposition!=="NO_INVOICE")}} accountingFlow />;
}
