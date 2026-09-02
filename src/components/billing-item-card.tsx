"use client";

import { ItemProductionAction } from "@/components/delivery";
import { CurrencyAmount } from "@/components/currency-amount";
import { useI18n } from "@/components/providers";
import { useScope } from "@/components/scope";
import { Amount, StatusPill, type WorkStatus } from "@/components/ui";
import { isBillingLocked, isProductionComplete, priceState } from "@/lib/derive";
import { money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

/** A full-row work item. The row surface, not just its title, is the target. */
export function BillingItemCard({
  item,
  projectId: _projectId,
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
  const needsPriceReview = !history && !locked && state !== "CONFIRMED";
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
      className={`grid grid-cols-[minmax(0,1fr)_84px] items-start gap-x-4 gap-y-0.5 rounded-xl px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] ${
        onOpen
          ? "cursor-pointer outline-none transition-colors hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent"
          : ""
      }`}
    >
      <div className="col-start-1 row-span-2 row-start-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={workStatus} className="shrink-0" />
          <span className="block min-w-0 flex-1 truncate text-[15px] font-medium tracking-[-0.008em]">
            {item.description}
          </span>
        </div>
        {spec && <p className="mt-1 min-w-0 truncate text-[12.5px] text-muted">{spec}</p>}
      </div>

      <div className="col-start-2 row-start-1 flex min-w-[84px] flex-col items-end">
        {item.amount > 0 ? (
          <CurrencyAmount
            usd={item.amount}
            rate={!history && !locked ? scope?.snapshot.exchangeRate?.rate : null}
            className="text-[15px]"
          />
        ) : (
          <Amount value="—" className="text-[15px]" />
        )}
        {item.type === "PRINT" && item.billingPriceManual && (
          <span className="mt-0.5 text-[10.5px] text-faint">Manual</span>
        )}
      </div>

      {!history && !locked && (
        <div className="col-start-1 col-span-2 row-start-2 flex flex-wrap justify-end gap-1.5 sm:col-start-2 sm:col-span-1">
          {needsPriceReview && onOpen && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className={REVIEW_BUTTON}
            >
              {t("projects.reviewPrice")}
            </button>
          )}
          <span onClick={(event) => event.stopPropagation()}>
            <ItemProductionAction
              item={item}
              size="sm"
              variant={needsPriceReview ? "secondary" : undefined}
            />
          </span>
        </div>
      )}
    </article>
  );
}

const REVIEW_BUTTON =
  "inline-flex h-8 min-w-[84px] shrink-0 items-center justify-center rounded-full bg-accent px-3 text-[12.5px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover";

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
    else {
      parts.push(item.unitPrice > 0 ? `${item.quantity} × ${money(item.unitPrice)}` : `×${item.quantity}`);
    }
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