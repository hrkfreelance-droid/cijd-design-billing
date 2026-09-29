"use client";

import { useParams } from "next/navigation";

import { TaxInvoicePage } from "@/components/billing-v5/tax-invoice-page";

export default function BillingV5TaxInvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <TaxInvoicePage id={id} />;
}
