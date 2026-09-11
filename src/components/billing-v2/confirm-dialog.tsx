"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";

import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui";

/**
 * The one question Billing V2 asks before an action that cannot be taken back
 * (billing, deleting, bringing billed work back).
 *
 * A short card: centred on a desktop, resting on the bottom edge on a phone
 * the way an iOS action sheet does. It is a Base UI alert dialog, so when it is
 * rendered inside a project sheet it stacks on top of it instead of closing it.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  tone = "default",
  busy = false,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: "default" | "destructive";
  busy?: boolean;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="overlay-surface confirm-backdrop fixed inset-0 z-[140]" />
        <AlertDialog.Viewport className="fixed inset-0 z-[141] flex items-end justify-center safe-bottom-bar p-3 lg:items-center lg:p-6">
          <AlertDialog.Popup
            data-testid={testId}
            className="confirm-popup w-full max-w-[420px] rounded-[18px] border border-line bg-panel p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
          >
            <AlertDialog.Title className="text-[17px] font-semibold tracking-[-0.012em]">{title}</AlertDialog.Title>
            <AlertDialog.Description render={<div />} className="mt-1.5 text-[14px] leading-relaxed text-muted">
              {message}
            </AlertDialog.Description>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <AlertDialog.Close render={<Button variant="secondary" full disabled={busy} />}>
                {t("common.cancel")}
              </AlertDialog.Close>
              <Button
                variant={tone === "destructive" ? "destructive" : "primary"}
                full
                onClick={onConfirm}
                disabled={busy}
                data-testid={testId ? `${testId}-confirm` : undefined}
              >
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
