"use client";

import Link from "next/link";

import { ItemProductionAction } from "@/components/delivery";
import { useI18n } from "@/components/providers";
import { Amount, StatusPill, type WorkStatus } from "@/components/ui";
import { isProductionComplete, priceState } from "@/lib/derive";
import { money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

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
  const detail =
    item.quantity !== 1
      ? `${item.quantity} × ${money(item.unitPrice)}`
      : item.note?.trim() || typeLabel;
  const workStatus: WorkStatus = finished
    ? item.productionStatus === "DELIVERED"
      ? "DELIVERED"
      : "COMPLETED"
    : state === "SUGGESTED" || state === "PENDING"
      ? "NEEDS_REVIEW"
      : "IN_PROGRESS";

  const info = (
    <div className="min-w-0 flex-1 text-left">
      <div className="min-w-0 flex-1">
        <p className="mt-1 truncate text-[15px] font-medium tracking-[-0.008em]">
          {item.description}
        </p>
        <p className="mt-1 truncate text-[12.5px] text-muted">{typeLabel} · {detail}</p>
      </div>
      <PriceStateLabel item={item} />
    </div>
  );

  return (
    <article data-testid="designer-project-item" className="py-5">
      <div className="flex items-start justify-between gap-4">
        <StatusPill status={workStatus} />
        <Amount value={item.amount > 0 ? money(item.amount) : "—"} className="shrink-0 text-[15px]" />
      </div>

      <div className="mt-3 flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left transition-colors duration-150 hover:text-muted"
          >
            {info}
          </button>
        ) : (
          <Link
            href={`/designer/projects/${projectId}`}
            className="min-w-0 flex-1 text-left transition-colors duration-150 hover:text-muted"
          >
            {info}
          </Link>
        )}

        {!history && (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full">
            {state !== "CONFIRMED" && (
              onOpen ? (
                <button
                  type="button"
                  onClick={onOpen}
                  className="inline-flex h-8 items-center rounded-full px-2.5 text-[12px] font-medium text-review transition-colors hover:bg-review/10"
                >
                  {t("projects.reviewPrice")}
                </button>
              ) : (
                <Link
                  href={`/designer/projects/${projectId}?item=${encodeURIComponent(item.id)}`}
                  className="inline-flex h-8 items-center rounded-full px-2.5 text-[12px] font-medium text-review transition-colors hover:bg-review/10"
                >
                  {t("projects.reviewPrice")}
                </Link>
              )
            )}
            <ItemProductionAction item={item} size="sm" />
          </div>
        )}
      </div>
    </article>
  );
}

/** Keep existing OTHER records intact while giving well-known item names a useful UI label. */
function displayTypeLabel(item: BillingItem, fallback: string): string {
  if (item.type !== "OTHER") return fallback;
  const normalized = item.description.trim().toLowerCase();
  if (normalized.startsWith("revision")) return "Revision";
  if (normalized.startsWith("istand") || normalized.startsWith("i-stand")) return "iStand";
  return fallback;
}

function PriceStateLabel({ item }: { item: BillingItem }) {
  const { t } = useI18n();
  const state = priceState(item);

  if (state === "PENDING") {
    return (
      <span className="mt-2 inline-flex max-w-full rounded-full bg-review/10 px-2 py-1 text-[11px] font-medium text-review">
        <span className="truncate">{t("projects.pricePending")} · {t("projects.priceReview")}</span>
      </span>
    );
  }

  return (
    <span className={`mt-2 inline-flex max-w-full rounded-full px-2 py-1 text-[11px] font-medium ${state === "SUGGESTED" ? "bg-review/10 text-review" : "bg-fill text-muted"}`}>
      <span className="truncate">
        {state === "SUGGESTED" ? `${t("projects.priceSuggested", { amount: money(item.amount) })} · ${t("projects.priceReview")}` : t("projects.priceConfirmed", { amount: money(item.amount) })}
      </span>
    </span>
  );
}
