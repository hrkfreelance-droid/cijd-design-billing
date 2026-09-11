"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, type ReactNode } from "react";
import { MobileBottomSheet, useIsMobileViewport } from "@/components/ui/mobile-bottom-sheet";

/**
 * One modal shape for Billing V2.
 *
 * A sheet from the bottom on a phone, a centred panel on a desktop, and the
 * same three regions either way: a header that says what you are looking at, a
 * body that scrolls, and a footer holding the one action that matters.
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
}: {
  open: boolean;
  onClose: () => void;
  /** Small line above the title: which state this record is in. */
  kicker?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  /** While a save is in flight the modal cannot be dismissed out from under it. */
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobileViewport();

  useEffect(() => {
    if (!open || isMobile === null || isMobile) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
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
        contentClassName="px-5 py-5 sm:px-6"
      >
        {children}
      </MobileBottomSheet>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 isolate flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => !busy && onClose()}
        className="overlay-surface animate-fade absolute inset-0 z-0 backdrop-blur-[3px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet relative z-10 flex max-h-[92dvh] min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-t-[26px] border border-line bg-panel shadow-[0_20px_60px_rgba(0,0,0,0.24)] sm:max-h-[min(85dvh,820px)] sm:w-[820px] sm:rounded-[22px]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {kicker && (
              <p className="text-[11.5px] font-semibold tracking-[0.04em] text-accent">{kicker}</p>
            )}
            <h2 className="mt-0.5 truncate text-[22px] font-semibold leading-tight tracking-[-0.021em]">
              {title}
            </h2>
            {subtitle && <p className="mt-1 truncate text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => !busy && onClose()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fill text-[22px] font-light leading-none text-text transition-colors hover:bg-fill-strong"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {children}
        </div>

        {footer && (
          <div className="safe-bottom-sheet shrink-0 border-t border-line px-5 pt-4 sm:px-6 sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A titled block inside a modal. Hairlines, not cards. */
export function ModalSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pt-6 first:pt-0">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
        {meta && <span className="shrink-0 text-[12.5px] text-muted">{meta}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}
