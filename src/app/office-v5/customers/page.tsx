"use client";

import { CustomerMaster } from "@/components/billing-v5/masters";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";
import { useV5T } from "@/lib/billing-v5/i18n";

/** V5-only customer list. Reuse the master editor/API and existing V5 data. */
export default function BillingV5CustomersPage() {
  const { snapshot } = useData();
  const t = useV5T();
  if (!snapshot) return <BoardSkeleton />;
  return (
    <div className="px-5 pb-32 pt-6 sm:px-8 sm:pt-8" data-testid="v5-customers-page">
      <header>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] sm:text-[30px]">{t("nav.customers")}</h1>
        <p className="mt-1 text-[13.5px] text-muted">{t("customers.subtitle")}</p>
      </header>
      <CustomerMaster snapshot={snapshot} />
    </div>
  );
}
