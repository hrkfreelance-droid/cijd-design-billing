"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/components/providers";
import type { ProjectBalance } from "@/lib/billing-v2/pricing";
import { moneyExact } from "@/lib/format";

/**
 * Final total, what has been received, and what is left to collect.
 *
 * Remaining is the number someone acts on, so it carries the weight; a
 * deposit above the total shows as Overpaid instead of a negative balance.
 * The deposit row is either read-only text or the field passed in.
 */
export function ProjectBalanceSummary({
  balance,
  depositField,
  pending = false,
  showFinal = true,
  testId = "v3-balance",
}: {
  balance: ProjectBalance;
  /** An input for the deposit while editing; the stored amount otherwise. */
  depositField?: ReactNode;
  /** Some line has no price yet, so the total is not final. */
  pending?: boolean;
  /** Off where the final total is already shown right above. */
  showFinal?: boolean;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <dl className="ml-auto w-full max-w-[22rem] text-[13.5px]" data-testid={testId}>
      {showFinal && (
        <Row label={t("v3.finalTotal")}>
          <span className="tnum font-medium" data-testid={`${testId}-final`}>
            {moneyExact(balance.finalTotal)}
          </span>
        </Row>
      )}
      <Row label={t("v3.deposit")} align={depositField ? "field" : "text"}>
        {depositField ?? (
          <span className="tnum text-muted" data-testid={`${testId}-deposit`}>
            {moneyExact(balance.deposit)}
          </span>
        )}
      </Row>
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-line pt-2.5">
        <dt className="text-[13px] font-semibold">{t("v3.remaining")}</dt>
        <dd className="text-right">
          <span
            className={`tnum block text-[20px] font-semibold leading-tight tracking-[-0.02em] ${pending ? "text-muted" : ""}`}
            data-testid={`${testId}-remaining`}
          >
            {moneyExact(balance.remaining)}
          </span>
          {balance.overpaid > 0 ? (
            <span className="tnum mt-0.5 block text-[12px] font-medium text-pending" data-testid={`${testId}-overpaid`}>
              {t("v3.overpaid")} {moneyExact(balance.overpaid)}
            </span>
          ) : balance.settled && !pending ? (
            <span className="mt-0.5 block text-[12px] font-medium text-paid" data-testid={`${testId}-paid`}>
              {t("v3.paidInFull")}
            </span>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}

function Row({
  label,
  align = "text",
  children,
}: {
  label: string;
  align?: "text" | "field";
  children: ReactNode;
}) {
  return (
    <div className={`flex justify-between gap-4 ${align === "field" ? "items-center py-1" : "items-baseline py-1.5"}`}>
      <dt className="text-muted">{label}</dt>
      <dd className={align === "field" ? "w-[9.5rem] shrink-0" : "text-right"}>{children}</dd>
    </div>
  );
}
