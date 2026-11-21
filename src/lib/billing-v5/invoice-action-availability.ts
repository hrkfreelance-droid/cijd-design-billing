import { toCents } from "./calculation";
import type { Snapshot, TaxInvoiceRecord } from "@/lib/types";

/** Same contract/sequence locks on the standalone page and the detail panel. */
export function invoiceActionAvailability(snapshot: Snapshot, invoice: TaxInvoiceRecord) {
  const kind = invoice.invoiceKind ?? "FULL";
  const deposit = kind === "DEPOSIT_FIXED" || kind === "DEPOSIT_PERCENT";
  const active = invoice.contractId ? (snapshot.taxInvoices ?? []).filter((entry) => entry.contractId === invoice.contractId && entry.status === "ISSUED") : [];
  const depositLocked = deposit && active.some((entry) => entry.invoiceKind === "FINAL");
  const activeIds = new Set(active.map((entry) => entry.id));
  const remaining = invoice.contractSnapshot?.lines.some((line) => {
    const allocated = (snapshot.billingAllocations ?? [])
      .filter((entry) => entry.billingItemId === line.billingItemId && !entry.voidedAt && activeIds.has(entry.invoiceId))
      .reduce((sum, entry) => sum + toCents(entry.amount), 0);
    return toCents(line.amount) > allocated;
  }) ?? false;
  const laterDeposit = deposit && active.some((entry) =>
    (entry.invoiceKind === "DEPOSIT_FIXED" || entry.invoiceKind === "DEPOSIT_PERCENT") && entry.id !== invoice.id && (
      entry.issuedAt.localeCompare(invoice.issuedAt) > 0 ||
      (entry.issuedAt === invoice.issuedAt && entry.invoiceNumber.localeCompare(invoice.invoiceNumber) > 0)
    ));
  return { depositLocked, laterDeposit, canIssueFinal: invoice.status === "ISSUED" && Boolean(invoice.contractId) && deposit && !depositLocked && remaining };
}

