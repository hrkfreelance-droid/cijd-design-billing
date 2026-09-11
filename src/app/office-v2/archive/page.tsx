"use client";

import { ArchiveBoard } from "@/components/billing-v2/archive-board";
import { useData } from "@/components/providers";
import { PageSkeleton } from "@/components/scope";

export default function BillingV2ArchivePage() {
  const { snapshot } = useData();
  if (!snapshot) return <PageSkeleton />;
  return <ArchiveBoard snapshot={snapshot} clientId={null} />;
}
