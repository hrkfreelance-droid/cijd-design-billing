/**
 * Display-only ordering: compare the numeric portion of invoice numbers,
 * independently of customer, invoice date and legacy prefix (CIJD / CIJDTI).
 * No stored invoice record is changed by this comparator.
 */
export function compareInvoiceNumbersDesc(a: string, b: string): number {
  const left = a.replace(/\D/g, "");
  const right = b.replace(/\D/g, "");
  if (left && right) {
    const l = BigInt(left);
    const r = BigInt(right);
    if (l !== r) return l > r ? -1 : 1;
  } else if (left || right) {
    return left ? -1 : 1;
  }
  return b.localeCompare(a, "en", { numeric: true, sensitivity: "base" });
}
