"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, type ReactNode } from "react";
import { MobileBottomSheet, useIsMobileViewport } from "@/components/ui/mobile-bottom-sheet";

/**
 * One modal shape for Billing V2.
 *
 * On a phone it is the DAISHIN sheet (Base UI Drawer: 1:1 drag, velocity
 * settle, scroll handoff). On a desktop it is a centred panel. Either way it
 * has the same three regions: a header that says what you are looking at, a
 * body that scrolls, and a footer that holds the actions and never scrolls.
 */
export function Modal({
  open,
  onClose,
  kicker,
  title,
  subtitle,
  children,
  footer,
  closeLabel,
  busy = false,
  size = "lg",
  testId,
}: {
  open: boolean;
  onClose: () => void;
  /** Small line above the title — the client. */
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  /** While a save is in flight the modal cannot be dismissed out from under it. */
  busy?: boolean;
  /** `lg` for a project, `sm` for a short form. */
  size?: "sm" | "lg";
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobileViewport();

  useEffect(() => {
    if (!open || isMobile === null || isMobile) return;
    const onKey = (event: KeyboardEvent) => {
      // A confirmation on top of this modal owns Escape while it is open.
      if (event.key !== "Escape" || busy || document.querySelector("[role=alertdialog]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, isMobile, onClose]);

  if (!open || isMobile === null) return null;

  if (isMobile) {
    return (
      <MobileBottomSheet
        open
        onClose={onClose}
        closeLabel={closeLabel}
        kicker={kicker}
        title={title}
        subtitle={subtitle}
        disabled={busy}
        footer={footer}
        contentClassName="px-5 pt-4"
      >
        <div data-testid={testId}>{children}</div>
      </MobileBottomSheet>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 isolate flex items-center justify-center p-6">
      <div
        aria-hidden
        onClick={() => !busy && onClose()}
        className="overlay-surface animate-fade absolute inset-0 z-0"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={`animate-sheet relative z-10 flex max-h-[min(88dvh,860px)] min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[18px] border border-line bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.22)] ${
          size === "sm" ? "max-w-[460px]" : "max-w-[880px]"
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
          <div className="min-w-0">
            {kicker && <p className="truncate text-[12.5px] font-medium text-muted">{kicker}</p>}
            <h2 className="mt-0.5 text-[20px] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => !busy && onClose()}
            className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-fill hover:text-text"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
              <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>

        {footer && <div className="shrink-0 border-t border-line px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
