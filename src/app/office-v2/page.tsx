"use client";

import { BillingBoard } from "@/components/billing-v2/billing-board";
import { useData } from "@/components/providers";
import { PageSkeleton } from "@/components/scope";

export default function BillingV2Page() {
  const { snapshot } = useData();
  if (!snapshot) return <PageSkeleton />;
  // V2 shows every client at once, grouped — there is no client filter to obey.
  return <BillingBoard snapshot={snapshot} clientId={null} />;
}
