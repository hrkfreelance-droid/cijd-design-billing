"use client";

import Link from "next/link";

import { ItemProductionAction } from "@/components/delivery";
import { useI18n } from "@/components/providers";
import { Amount, StatusPill, type WorkStatus } from "@/components/ui";
import { isProductionComplete, priceState } from "@/lib/derive";
import { money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

/**
 * One billing item, the unit the workspace actually operates on.
 *
 * A three column grid keeps a list of these reading like a table: status at
 * the left, name and specification sharing the middle column so the second
 * line sits exactly under the first, and every amount landing in the same
 * right hand column. The amount is printed once — its certainty is a caption
 * underneath, not a second chip repeating the number.
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
  const state = priceState(item);
  const finished = isProductionComplete(item);
  const typeLabel = displayTypeLabel(item, t(`type.${item.type}`));
  const workStatus: WorkStatus = finished
    ? item.productionStatus === "DELIVERED"
      ? "DELIVERED"
      : "COMPLETED"
    : state === "SUGGESTED" || state === "PENDING"
      ? "NEEDS_REVIEW"
      : "IN_PROGRESS";
  const reviewHref = `/designer/projects/${projectId}?item=${encodeURIComponent(item.id)}`;
  const needsPriceReview = !history && state !== "CONFIRMED";
  const spec = specLine(item, typeLabel);

  const name = (
    <span className="block truncate text-[15px] font-medium tracking-[-0.008em]">
      {item.description}
    </span>
  );

  return (
    <article
      data-testid="designer-project-item"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-4"
    >
      {/* Status sits on its own line so that a wide label can never push the
          name column sideways — every row keeps the same left edge. */}
      <StatusPill status={workStatus} className="col-span-2 col-start-1 row-start-1 mb-2" />

      <div className="col-start-1 row-start-2 min-w-0">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="block w-full min-w-0 text-left transition-colors duration-150 hover:text-muted"
          >
            {name}
          </button>
        ) : (
          <Link
            href={`/designer/projects/${projectId}`}
            className="block w-full min-w-0 text-left transition-colors duration-150 hover:text-muted"
          >
            {name}
          </Link>
        )}
      </div>

      <Amount
        value={item.amount > 0 ? money(item.amount) : "—"}
        className="col-start-2 row-start-2 justify-self-end text-[15px]"
      />

      {spec && (
        <p className="col-start-1 row-start-3 mt-1 min-w-0 truncate text-[12.5px] text-muted">
          {spec}
        </p>
      )}

      <PriceStateCaption state={state} />

      {!history && (
        <div className="col-span-2 col-start-1 row-start-4 mt-3 flex flex-wrap items-center justify-end gap-2">
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
    <span className="col-start-2 row-start-3 mt-1 justify-self-end whitespace-nowrap text-[11.5px] font-medium text-review">
      {state === "PENDING" ? t("projects.pricePending") : t("projects.priceSuggestedShort")}
      {" · "}
      {t("projects.priceReview")}
    </span>
  );
}
