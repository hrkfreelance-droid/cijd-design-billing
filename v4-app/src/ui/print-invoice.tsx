"use client";

import { useEffect, useState } from "react";

import type { TaxInvoice } from "@/domain/types";
import { InvoiceDocument } from "@/ui/invoice-document";
import { PrintActions } from "@/ui/print-actions";

export function PrintInvoice({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<TaxInvoice | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/v4/tax-invoices/${encodeURIComponent(invoiceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as TaxInvoice | { error?: string };
        if (!response.ok) throw new Error("error" in result ? result.error ?? "Invoice could not be loaded" : "Invoice could not be loaded");
        if (active) setInvoice(result as TaxInvoice);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Invoice could not be loaded");
      });
    return () => { active = false; };
  }, [invoiceId]);

  if (error) return <main className="print-page"><p role="alert">{error}</p></main>;
  if (!invoice) return <main className="print-page"><p>Loading Tax Invoice…</p></main>;
  return <main className="print-page"><PrintActions /><InvoiceDocument invoice={invoice} /></main>;
}
