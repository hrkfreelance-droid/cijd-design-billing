/** Browser CSS px at 96 dpi; one physical A4 sheet is 210 x 297 mm. */
export const A4_WIDTH_PX = 210 * 96 / 25.4;
export const A4_HEIGHT_PX = 297 * 96 / 25.4;

/**
 * Fit the entire original invoice layout on one printed A4 sheet. Preserve
 * aspect ratio and allow a small safety margin against browser page rounding.
 * Do not change totals, line content, invoice numbers or the document template.
 */
export function invoicePageScale(contentHeightPx: number): number {
  if (!Number.isFinite(contentHeightPx) || contentHeightPx <= A4_HEIGHT_PX) return 1;
  return Math.min(1, (A4_HEIGHT_PX - 12) / contentHeightPx);
}
