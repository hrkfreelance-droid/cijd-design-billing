"use client";

import { money } from "@/lib/format";
import type { PriceEstimate } from "@/lib/billing-v5/service-price-estimates";
import { useSuggestionT } from "@/lib/billing-v5/suggestion-i18n";

export function estimateSummary(estimate: PriceEstimate, t: ReturnType<typeof useSuggestionT>) {
  return `${t("estimate")} ${money(estimate.price)} (${money(estimate.low)}–${money(estimate.high)}, ${t("similar").replace("{count}", String(estimate.samples.length))})${estimate.unit ? ` / ${estimate.unit}` : ""}`;
}

export function estimateBasis(estimate: PriceEstimate, t: ReturnType<typeof useSuggestionT>) {
  return [t("method"), ...estimate.samples.map((row) =>
    `${row.customer} · ${row.date} · ${row.description} · ×${row.quantity} ${row.unit} · ${money(row.price)}`)].join("\n");
}

/** Native disclosure works with keyboard and touch as well as pointer input. */
export function ServicePriceEstimate({ estimate, disabled, onApply, testId }: {
  estimate: PriceEstimate; disabled?: boolean; onApply?: () => void; testId?: string;
}) {
  const t = useSuggestionT();
  return <div className="ss-estimate" data-testid={testId}>
    <div className="ss-estimate-line">
      {onApply ? <button type="button" className="ss-estimate-apply" disabled={disabled} onClick={onApply}
        title={t("applyEstimate")} data-testid={testId ? `${testId}-apply` : undefined}>{estimateSummary(estimate, t)}</button>
        : <span>{estimateSummary(estimate, t)}</span>}
      {estimate.samples.length < 3 && <small data-testid={testId ? `${testId}-sparse` : undefined}>{t("sparse")}</small>}
    </div>
    <details className="ss-estimate-basis">
      <summary>{t("basis")}</summary>
      <p>{t("method")}</p>
      <ul>{estimate.samples.map((row) => <li key={row.id}>
        <span>{row.description}</span>
        <small>{row.customer} · {row.date} · ×{row.quantity} {row.unit} · {money(row.price)}</small>
      </li>)}</ul>
    </details>
  </div>;
}
