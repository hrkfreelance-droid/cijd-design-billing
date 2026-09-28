"use client";

import Link from "next/link";
import { BillingV3Board } from "@/components/billing-v3/billing-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";

export default function BillingV4Page() {
  const { snapshot } = useData();
  if (!snapshot) return <BoardSkeleton />;
  return <>
    <div className="flex items-center justify-between px-5 pt-6 sm:px-8 sm:pt-8">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Office V4</p><h1 className="mt-1 text-2xl font-semibold">Billing</h1></div>
      <Link href="/office-v4/tax-invoices" className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-fill">Tax Invoices</Link>
    </div>
    <BillingV3Board snapshot={snapshot} />
  </>;
}
