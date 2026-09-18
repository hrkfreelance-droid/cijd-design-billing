"use client";

import { ArchiveBoard } from "@/components/billing-v2/archive-board";
import { BoardSkeleton } from "@/components/billing-v2/v2-shell";
import { useData } from "@/components/providers";

export default function BillingV3ArchivePage() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return <ArchiveBoard snapshot={snapshot} />;
}
