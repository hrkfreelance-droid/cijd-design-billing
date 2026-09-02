"use client";

import { formatKhr } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";

/** A compact USD source amount with its fixed or current KHR companion. */
export function CurrencyAmount({
  usd,
  rate,
  className = "",
  strong = false,
}: {
  usd: number;
  rate?: number | null;
  className?: string;
  strong?: boolean;
}) {
  return (
    <span className={`tnum shrink-0 text-right ${className}`}>
      <span className={`block whitespace-nowrap ${strong ? "font-semibold" : ""}`}>
        {moneyExact(usd)}
      </span>
      {rate && rate > 0 ? (
        <span className="mt-px block whitespace-nowrap text-[12px] font-medium text-muted">
          {formatKhr(usd, rate)}
        </span>
      ) : null}
    </span>
  );
}
