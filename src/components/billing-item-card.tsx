"use client";

import Link from "next/link";

import { ItemProductionAction } from "@/components/delivery";
import { CurrencyAmount } from "@/components/currency-amount";
import { useI18n } from "@/components/providers";
import { useScope } from "@/components/scope";
import { Amount, StatusPill, type WorkStatus } from "@/components/ui";
import { isBillingLocked, isProductionComplete, priceState } from "@/lib/derive";
import { money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

/**
 * One billing item, the unit the workspace actually operates on.
 *
 * A compact two-column row keeps the project as the container: status and item
 * name stay together on the left, while USD, KHR, review state, and the next
 * action share one stable right-hand rail.
 */
export function BillingItemCard({
  item,
  projectId,
  history = false,
  onOpen,
}: {
  item: BillingItem;
  projectId: string;
  history?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const scope = useScope();
  const state = priceState(item);
  const finished = isProductionComplete(item);
  const locked = isBillingLocked(item);
  const typeLabel = displayTypeLabel(item, t(`type.${item.type}`));
  const workStatus: WorkStatus = finished
    ? item.productionStatus === "DELIVERED"
      ? "DELIVERED"
      : "COMPLETED"
    : state === "SUGGESTED" || state === "PENDING"
      ? "NEEDS_REVIEW"
      : "IN_PROGRESS";
  const reviewHref = `/designer/projects/${projectId}?item=${encodeURIComponent(item.id)}`;
  const needsPriceReview = !history && !locked && state !== "CONFIRMED";
  const spec = specLine(item, typeLabel);

  const name = (
    <span className="block truncate text-[15px] font-medium tracking-[-0.008em]">
      {item.description}
    </span>
  );

  return (
    <article
      data-testid="designer-project-item"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-3.5 sm:py-3"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={workStatus} className="shrink-0" />
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 flex-1 text-left transition-colors duration-150 hover:text-muted"
            >
              {name}
            </button>
          ) : (
            <Link
              href={`/designer/projects/${projectId}`}
              className="min-w-0 flex-1 text-left transition-colors duration-150 hover:text-muted"
            >
              {name}
            </Link>
          )}
        </div>
        {spec && <p className="mt-1 min-w-0 truncate text-[12.5px] text-muted">{spec}</p>}
      </div>

      <div className="row-span-2 flex min-w-[84px] flex-col items-end gap-1">
        {item.amount > 0 ? (
          <CurrencyAmount
            usd={item.amount}
            rate={!history && !locked ? scope?.snapshot.exchangeRate?.rate : null}
            className="text-[15px]"
          />
        ) : (
          <Amount value="—" className="text-[15px]" />
        )}

        <PriceStateCaption state={state} />

        {!history && !locked && (
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            {needsPriceReview &&
              (onOpen ? (
                <button type="button" onClick={onOpen} className={REVIEW_BUTTON}>
                  {t("projects.reviewPrice")}
                </button>
              ) : (
                <Link href={reviewHref} className={REVIEW_BUTTON}>
                  {t("projects.reviewPrice")}
                </Link>
              ))}
            {/* Until the price is settled, finishing the work is the lesser action. */}
            <ItemProductionAction
              item={item}
              size="sm"
              variant={needsPriceReview ? "secondary" : undefined}
            />
          </div>
        )}
      </div>
    </article>
  );
}

const REVIEW_BUTTON =
  "inline-flex h-9 min-w-[84px] shrink-0 items-center justify-center rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover";

/**
 * What this item actually is, in one line: the print run and its
 * specification, or a priced quantity. Returns empty when the name already
 * says everything — echoing "Revision" under "Revision" is noise, not detail.
 */
function specLine(item: BillingItem, typeLabel: string): string {
  const parts: string[] = [];
  // Real descriptions lead with the type ("Print x100", "Design & Map"), and
  // are stored in English while the label is localised — so the stored type has
  // to be matched too, or 印刷 reappears beside a name that already says Print.
  const name = item.description.trim().toLowerCase();
  const leadsWithType = (word: string) =>
    name === word || name.startsWith(`${word} `) || name.startsWith(`${word}×`);
  if (!leadsWithType(typeLabel.trim().toLowerCase()) && !leadsWithType(item.type.toLowerCase())) {
    parts.push(typeLabel);
  }
  if (item.quantity !== 1) {
    // "2000 × —" says nothing; with no rate yet the run size is the fact.
    parts.push(
      item.unitPrice > 0
        ? `${item.quantity} × ${money(item.unitPrice)}`
        : `×${item.quantity}`,
    );
  }
  if (item.printSize) parts.push(item.printSize);
  return parts.join(" · ");
}

/** Keep existing OTHER records intact while giving well-known item names a useful UI label. */
function displayTypeLabel(item: BillingItem, fallback: string): string {
  if (item.type !== "OTHER") return fallback;
  const normalized = item.description.trim().toLowerCase();
  if (normalized.startsWith("revision")) return "Revision";
  if (normalized.startsWith("istand") || normalized.startsWith("i-stand")) return "iStand";
  return fallback;
}

/**
 * Certainty of the amount printed above it. A confirmed price says nothing —
 * the number on its own already means confirmed.
 */
function PriceStateCaption({ state }: { state: ReturnType<typeof priceState> }) {
  const { t } = useI18n();
  if (state === "CONFIRMED") return null;
  return (
    <span className="whitespace-nowrap text-[11.5px] font-medium text-review">
      {state === "PENDING" ? t("projects.pricePending") : t("projects.priceSuggestedShort")}
      {" · "}
      {t("projects.priceReview")}
    </span>
  );
}
