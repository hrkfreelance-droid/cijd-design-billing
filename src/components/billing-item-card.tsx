"use client";

import { ItemProductionAction } from "@/components/delivery";
import { CurrencyAmount } from "@/components/currency-amount";
import { useI18n } from "@/components/providers";
import { useScope } from "@/components/scope";
import { Amount, StatusPill, type WorkStatus } from "@/components/ui";
import { isBillingLocked, isProductionComplete, priceState } from "@/lib/derive";
import { money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

/**
 * DAISHIN-style work row: the whole row is the target, while only the single
 * next action is shown inline. Detail/edit controls belong in the detail sheet.
 */
export function BillingItemCard({
  item,
  projectId: _projectId,
  history = false,
  onOpen,
  showActions = true,
}: {
  item: BillingItem;
  projectId: string;
  history?: boolean;
  onOpen?: () => void;
  showActions?: boolean;
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
  const needsPriceReview = !history && !locked && state !== "CONFIRMED";
  const blockPrintDelivery = item.type === "PRINT" && needsPriceReview;
  const spec = specLine(item, typeLabel);

  const open = (event: React.SyntheticEvent) => {
    if (!onOpen || hasInteractiveTarget(event.target)) return;
    event.stopPropagation();
    onOpen();
  };

  return (
    <article
      data-testid="designer-project-item"
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? item.description : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (!onOpen || hasInteractiveTarget(event.target)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      className={`min-w-0 px-3 py-3 outline-none transition-colors ${
        onOpen ? "cursor-pointer hover:bg-fill/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" : ""
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex min-w-0 items-center gap-2">
            <StatusPill status={workStatus} className="shrink-0" />
            {item.type === "PRINT" && item.billingPriceManual && (
              <span className="text-[10.5px] font-medium text-faint">Manual</span>
            )}
          </div>
          <p className="truncate text-[15px] font-medium tracking-[-0.008em] text-text">
            {item.description}
          </p>
          {spec && <p className="mt-1 truncate text-[12.5px] text-muted">{spec}</p>}
        </div>

        <div className="shrink-0 text-right">
          {item.amount > 0 ? (
            <CurrencyAmount
              usd={item.amount}
              rate={!history && !locked ? scope?.snapshot.exchangeRate?.rate : null}
              className="text-[15px]"
            />
          ) : (
            <Amount value="—" className="text-[15px]" />
          )}
        </div>
      </div>

      {showActions && !history && !locked && (
        <div className="mt-3 flex justify-end">
          {needsPriceReview && onOpen ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-[18px] text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              {t("projects.reviewPrice")}
            </button>
          ) : !blockPrintDelivery ? (
            <span onClick={(event) => event.stopPropagation()}>
              <ItemProductionAction item={item} size="md" />
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

function hasInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element &&
    !!target.closest("button, a, input, select, textarea, [role='checkbox'], [data-no-row-open]");
}

function specLine(item: BillingItem, typeLabel: string): string {
  const parts: string[] = [];
  const name = item.description.trim().toLowerCase();
  const leadsWithType = (word: string) =>
    name === word || name.startsWith(`${word} `) || name.startsWith(`${word}×`);

  if (!leadsWithType(typeLabel.trim().toLowerCase()) && !leadsWithType(item.type.toLowerCase())) {
    parts.push(typeLabel);
  }
  if (item.quantity !== 1) {
    if (item.type === "PRINT") parts.push(`×${item.quantity}`);
    else parts.push(item.unitPrice > 0 ? `${item.quantity} × ${money(item.unitPrice)}` : `×${item.quantity}`);
  }
  if (item.printSize) parts.push(item.printSize);
  return parts.join(" · ");
}

function displayTypeLabel(item: BillingItem, fallback: string): string {
  if (item.type !== "OTHER") return fallback;
  const normalized = item.description.trim().toLowerCase();
  if (normalized.startsWith("revision")) return "Revision";
  if (normalized.startsWith("istand") || normalized.startsWith("i-stand")) return "iStand";
  return fallback;
}
