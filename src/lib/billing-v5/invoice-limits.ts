/** Shared API and editor limit. Keep the UI in step with server validation. */
export const MAX_INVOICE_ITEMS = 40;

/** The editor adds only as many rows as the server will accept. */
export function additionalInvoiceRows(current: number, requested: number): number {
  return Math.max(0, Math.min(Math.max(0, Math.floor(requested)), MAX_INVOICE_ITEMS - current));
}
