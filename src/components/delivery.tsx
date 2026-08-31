"use client";

import { useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, ConfirmSheet } from "@/components/ui";
import { isProductionComplete, productionAction } from "@/lib/derive";
import type { BillingItem } from "@/lib/types";

/**
 * The handoff. Pressing this is the moment work leaves the designer's side and
 * appears on the billing side, so it always asks first.
 */
export function DeliverButton({
  projectId,
  size = "md",
  full = false,
  disabled = false,
  onDone,
}: {
  projectId: string;
  size?: "sm" | "md";
  full?: boolean;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [asking, setAsking] = useState(false);

  const deliver = async () => {
    const ok = await run(
      () => api(`/api/projects/${projectId}/delivery`, { method: "POST" }),
      { key: "delivery.toast" },
    );
    setAsking(false);
    if (ok) onDone?.();
  };

  return (
    <>
      <Button
        variant="primary"
        size={size}
        full={full}
        disabled={disabled || busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setAsking(true);
        }}
      >
        {size === "sm" ? t("delivery.markShort") : t("delivery.mark")}
      </Button>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={deliver}
        title={t("delivery.confirmTitle")}
        message={t("delivery.confirmBody")}
        confirmLabel={t("delivery.mark")}
        busy={busy}
      />
    </>
  );
}

export function UndeliverButton({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        onClick={() => setAsking(true)}
        className="text-[13px] text-faint transition-colors hover:text-review"
      >
        {t("delivery.undo")}
      </button>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          await run(() => api(`/api/projects/${projectId}/delivery`, { method: "DELETE" }), {
            key: "delivery.undoToast",
          });
          setAsking(false);
        }}
        title={t("delivery.undo")}
        message={t("delivery.undoConfirm")}
        confirmLabel={t("delivery.undo")}
        busy={busy}
      />
    </>
  );
}

/** Item-level production action. Creative work completes; PRINT is delivered. */
export function ItemProductionAction({
  item,
  size = "sm",
  full = false,
  variant,
  onDone,
}: {
  item: BillingItem;
  size?: "sm" | "md";
  full?: boolean;
  /** Demoted to secondary where an earlier step (price review) outranks it. */
  variant?: "primary" | "secondary";
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [asking, setAsking] = useState(false);
  const action = productionAction(item);
  const finished = isProductionComplete(item);
  const delivery = action === "DELIVER";
  const endpoint = delivery ? "delivery" : "complete";
  const activeLabel = delivery ? t("delivery.mark") : t("production.complete");
  const undoLabel = delivery ? t("delivery.undo") : t("production.undoComplete");
  const activeToast = delivery ? "delivery.toast" : "production.completeToast";
  const undoToast = delivery ? "delivery.undoToast" : "production.undoCompleteToast";

  const apply = async () => {
    const ok = await run(
      () => api(`/api/billing-items/${item.id}/${endpoint}`, { method: finished ? "DELETE" : "POST" }),
      { key: finished ? undoToast : activeToast },
    );
    setAsking(false);
    if (ok) onDone?.();
  };

  return (
    <>
      <Button
        variant={variant ?? (finished ? "secondary" : "primary")}
        size={size}
        full={full}
        disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setAsking(true);
        }}
      >
        {finished ? undoLabel : size === "sm" ? (delivery ? t("delivery.markShort") : t("production.completeShort")) : activeLabel}
      </Button>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={apply}
        title={
          finished
            ? undoLabel
            : delivery
              ? t("delivery.confirmTitle")
              : t("production.completeConfirmTitle")
        }
        message={
          finished
            ? delivery
              ? t("delivery.undoConfirm")
              : t("production.undoCompleteConfirmBody")
            : delivery
              ? t("delivery.confirmBody")
              : t("production.completeConfirmBody")
        }
        confirmLabel={finished ? undoLabel : activeLabel}
        busy={busy}
      />
    </>
  );
}

/** The plain, unmistakable "this is done" marker. */
export function DeliveredMark({ date }: { date?: string | null }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-paid">
      <span aria-hidden>✓</span>
      {date ? t("delivery.on", { date }) : t("delivery.done")}
    </span>
  );
}

export function CompletedMark({ date }: { date?: string | null }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-paid">
      <span aria-hidden>✓</span>
      {date ? `${t("production.completed")} · ${date}` : t("production.completed")}
    </span>
  );
}
