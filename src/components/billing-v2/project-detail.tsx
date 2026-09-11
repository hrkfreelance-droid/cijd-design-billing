"use client";

import { useI18n } from "@/components/providers";
import type { BoardItem, BoardProject } from "@/lib/billing-v2/board";
import { isCostPriced, serviceLabel } from "@/lib/billing-v2/services";
import { moneyExact } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** A price, or the words "Price pending" — never a dash that could be read as $0. */
export function Price({
  value,
  className = "",
  testId,
}: {
  value: number | null | undefined;
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  if (value == null) {
    return (
      <span className={`whitespace-nowrap text-pending ${className}`} data-testid={testId} data-pending="true">
        {t("v2.price.pending")}
      </span>
    );
  }
  return (
    <span className={`tnum whitespace-nowrap ${className}`} data-testid={testId}>
      {moneyExact(value)}
    </span>
  );
}

export function marginLabel(entry: BoardItem, t: Translate): string | null {
  return entry.margin == null ? null : t("v2.margin", { percent: Math.round(entry.margin * 100) });
}

/** Why a project is not ready yet, in a few words; null when there is nothing to say. */
export function projectReason(project: BoardProject, t: Translate): string | null {
  switch (project.blocker) {
    case null:
    case "STATUS":
      return null;
    case "PRICE":
      return t("v2.pricePending", { count: project.pricePendingCount });
    default:
      return t(`v2.blocked.${project.blocker}` as MessageKey, {
        service: project.blockedBy ? serviceLabel(project.blockedBy.service, t) : "",
      });
  }
}

/** The status line under a project's title. */
export function projectStatus(project: BoardProject, t: Translate): string {
  if (project.blocker === null) return t("v2.section.ready");
  const reason = projectReason(project, t);
  return reason ? `${t("v2.section.inProgress")} · ${reason}` : t("v2.section.inProgress");
}

const TABLE = "sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_3.25rem_5.75rem_7rem_6.75rem] sm:gap-x-4";

/**
 * A project, read-only: every line with its quantity, cost, recommendation and
 * final price, then the total. No field on this screen can be edited.
 */
export function ProjectDetail({ project }: { project: BoardProject }) {
  const { t } = useI18n();
  const hasCost = project.items.some((entry) => isCostPriced(entry.service));

  return (
    <div data-testid="v2-view-mode">
      {project.items.length === 0 ? (
        <p className="border-y border-line py-6 text-[14px] text-muted">{t("v2.noItems")}</p>
      ) : (
        <div role="table" aria-label={t("v2.lineItems")}>
          <div
            role="row"
            className={`hidden border-b border-line pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint ${TABLE}`}
          >
            <span role="columnheader">{t("v2.service")}</span>
            <span role="columnheader">{t("v2.description")}</span>
            <span role="columnheader" className="text-right">{t("v2.quantity")}</span>
            <span role="columnheader" className="text-right">{hasCost ? t("v2.cost") : ""}</span>
            <span role="columnheader" className="text-right">{hasCost ? t("v2.recommended") : ""}</span>
            <span role="columnheader" className="text-right">{t("v2.finalPrice")}</span>
          </div>

          {project.items.map((entry) => (
            <DetailRow key={entry.item.id} entry={entry} />
          ))}

          <div
            role="row"
            className={`flex items-baseline justify-between gap-4 pt-4 ${TABLE} sm:items-baseline`}
          >
            <span role="rowheader" className="text-[14px] font-medium sm:col-span-3">
              {t("v2.projectTotal")}
            </span>
            <span role="cell" className="hidden text-right text-[12.5px] text-muted sm:block">
              {hasCost ? <Price value={project.costTotal} /> : null}
            </span>
            <span role="cell" className="hidden sm:block" />
            <span role="cell" className="text-right">
              {project.pricePendingCount > 0 ? (
                <Price value={null} className="text-[15px] font-medium" testId="v2-view-project-total" />
              ) : (
                <Price
                  value={project.total}
                  className="text-[19px] font-semibold tracking-[-0.02em]"
                  testId="v2-view-project-total"
                />
              )}
            </span>
          </div>
          {project.pricePendingCount > 0 && project.total > 0 && (
            <p className="mt-1 text-right text-[12px] text-muted">
              {t("v2.total")} <Price value={project.total} /> + {t("v2.pricePending", { count: project.pricePendingCount })}
            </p>
          )}
        </div>
      )}

      {project.note.trim() && (
        <div className="mt-7 border-t border-line pt-4" data-testid="v2-view-note">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{t("v2.note")}</p>
          <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-muted">{project.note}</p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ entry }: { entry: BoardItem }) {
  const { t } = useI18n();
  const costPriced = isCostPriced(entry.service);
  const margin = marginLabel(entry, t);
  return (
    <div
      role="row"
      className={`border-b border-line py-3.5 ${TABLE} sm:items-baseline`}
      data-testid="v2-view-item"
    >
      {/* Phone: service over title, price on the right, the numbers underneath. */}
      <span role="cell" className="block text-[12px] text-muted sm:text-[13.5px] sm:text-text">
        {serviceLabel(entry.service, t)}
      </span>
      <div className="flex items-baseline justify-between gap-4 sm:contents">
        <span role="cell" className="min-w-0 text-[15px] font-medium sm:text-[13.5px] sm:font-normal">
          {entry.item.description.trim() || serviceLabel(entry.service, t)}
        </span>
        <span role="cell" className="tnum hidden text-right text-[13.5px] text-muted sm:block">
          {entry.item.quantity}
        </span>
        <span role="cell" className="hidden text-right text-[13.5px] text-muted sm:block">
          {costPriced ? <Price value={entry.cost} testId={`v2-view-cost-${entry.item.id}`} /> : null}
        </span>
        <span role="cell" className="hidden text-right text-[13.5px] text-muted sm:block">
          {costPriced && entry.recommended != null ? (
            <>
              <Price value={entry.recommended} testId={`v2-view-recommended-${entry.item.id}`} />
              {margin && <span className="block text-[11.5px] text-faint">{margin}</span>}
            </>
          ) : null}
        </span>
        <span role="cell" className="shrink-0 text-right text-[15px] font-medium sm:text-[14px]">
          <Price value={entry.amount} testId={`v2-view-final-${entry.item.id}`} />
          {entry.manual && <span className="block text-[11.5px] font-normal text-faint">{t("v2.manual")}</span>}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] text-muted sm:hidden">
        {t("v2.quantity")} {entry.item.quantity}
        {costPriced && (
          <>
            {" · "}
            {t("v2.cost")} <Price value={entry.cost} />
            {entry.recommended != null && (
              <>
                {" · "}
                {t("v2.recommended")} <Price value={entry.recommended} />
                {margin ? ` (${margin})` : ""}
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
