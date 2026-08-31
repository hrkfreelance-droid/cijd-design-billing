"use client";

import Link from "next/link";

import { ChevronRight } from "@/components/icons";
import { ItemProductionAction } from "@/components/delivery";
import { useI18n } from "@/components/providers";
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
  const productionLabel = finished
    ? item.productionStatus === "DELIVERED"
      ? t("projects.delivered")
      : t("projects.completed")
    : t("projects.inProgress");

  const info = (
    <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
          {typeLabel}
        </p>
        <p className="mt-1 truncate text-[15px] font-medium tracking-[-0.008em]">
          {item.description}
        </p>
        <p className="mt-1 truncate text-[12.5px] text-muted">{detail}</p>
      </div>
      <PriceStateLabel item={item} />
      {!onOpen && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-faint" />}
    </div>
  );

  return (
    <article data-testid="designer-project-item" className="py-4">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-start transition-colors duration-150 hover:bg-fill active:bg-fill"
        >
          {info}
        </button>
      ) : (
        <Link
          href={`/designer/projects/${projectId}`}
          className="flex w-full items-start transition-colors duration-150 hover:bg-fill active:bg-fill"
        >
          {info}
        </Link>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${finished ? "text-paid" : "text-muted"}`}>
          <span aria-hidden>{finished ? "✓" : "○"}</span>
          {productionLabel}
        </span>

        {!history && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {state !== "CONFIRMED" && (
              onOpen ? (
                <button
                  type="button"
                  onClick={onOpen}
                  className="inline-flex min-h-8 items-center rounded-full px-2.5 text-[12px] font-medium text-review transition-colors hover:bg-review/10"
                >
                  {t("projects.reviewPrice")}
                </button>
              ) : (
                <Link
                  href={`/designer/projects/${projectId}?item=${encodeURIComponent(item.id)}`}
                  className="inline-flex min-h-8 items-center rounded-full px-2.5 text-[12px] font-medium text-review transition-colors hover:bg-review/10"
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
      <span className="flex w-[100px] shrink-0 flex-col items-end gap-0.5 text-right">
        <span className="text-[13px] font-medium text-review">{t("projects.pricePending")}</span>
        <span className="text-[11px] text-review">{t("projects.priceReview")}</span>
      </span>
    );
  }

  return (
    <span className="flex w-[100px] shrink-0 flex-col items-end gap-0.5 text-right">
      <span className={`tnum text-[13.5px] font-medium ${state === "SUGGESTED" ? "text-review" : "text-text"}`}>
        {t(state === "SUGGESTED" ? "projects.priceSuggested" : "projects.priceConfirmed", {
          amount: money(item.amount),
        })}
      </span>
      {state === "SUGGESTED" && (
        <span className="text-[11px] text-review">{t("projects.priceReview")}</span>
      )}
    </span>
  );
}
