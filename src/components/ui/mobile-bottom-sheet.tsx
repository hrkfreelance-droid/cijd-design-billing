"use client";

import * as React from "react";
import { Drawer } from "@base-ui/react/drawer";
import styles from "./mobile-bottom-sheet.module.css";

const OPEN_SNAP_POINT: Drawer.Root.SnapPoint = 0.94;
const SNAP_POINTS: Drawer.Root.SnapPoint[] = [OPEN_SNAP_POINT];

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[19px] w-[19px]" aria-hidden="true">
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The shared breakpoint used by the DAISHIN ORDER canonical Sheet behavior. */
export function useIsMobileViewport() {
  const [isMobile, setIsMobile] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

type MobileBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  title: string;
  kicker?: string;
  subtitle?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
};

/**
 * Mobile interaction shared with the latest DAISHIN ORDER canonical Sheet.
 * Base UI owns the pointer/touch tracking, velocity threshold, snap settling,
 * scroll handoff, and body scroll lock; this layer only supplies CIJD content.
 */
export function MobileBottomSheet({
  open,
  onClose,
  closeLabel,
  title,
  kicker,
  subtitle,
  disabled = false,
  children,
  footer,
  contentClassName,
}: MobileBottomSheetProps) {
  const isMobile = useIsMobileViewport();
  const [snapPoint, setSnapPoint] = React.useState<Drawer.Root.SnapPoint | null>(OPEN_SNAP_POINT);

  React.useEffect(() => {
    if (open) {
      // The canonical DAISHIN Drawer resets to its single open snap point.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapPoint(OPEN_SNAP_POINT);
    }
  }, [open]);

  const drawerOpen = open && isMobile === true;

  return (
    <Drawer.Root
      open={drawerOpen}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && disabled) {
          eventDetails.cancel();
          return;
        }
        if (!nextOpen) onClose();
      }}
      swipeDirection="down"
      snapPoints={SNAP_POINTS}
      snapPoint={snapPoint}
      onSnapPointChange={setSnapPoint}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className={styles.backdrop} />
          <Drawer.Viewport className={styles.viewport}>
            <Drawer.Popup className={`${styles.popup} border border-line/80 bg-panel shadow-2xl`}>
              <div className={`${styles.header} bg-panel`}>
                <div className={styles.dragArea} aria-hidden="true">
                  <div className={styles.handle} />
                </div>

                <header className="flex items-start justify-between gap-4 border-b border-line px-5 pb-3.5 pt-0.5">
                  <div className="min-w-0 pt-0.5">
                    {kicker ? <p className="truncate text-[12px] font-medium text-muted">{kicker}</p> : null}
                    <Drawer.Title className="mt-0.5 line-clamp-2 text-[20px] font-semibold leading-[1.2] tracking-[-0.02em] text-text">
                      {title}
                    </Drawer.Title>
                    {subtitle ? <div className="mt-1 text-[13px] text-muted">{subtitle}</div> : null}
                  </div>
                  <Drawer.Close
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fill text-text transition active:scale-95"
                    aria-label={closeLabel}
                    disabled={disabled}
                  >
                    <CloseIcon />
                  </Drawer.Close>
                </header>
              </div>

              <Drawer.Content
                data-daishin-sheet-scroll="true"
                className={`${styles.scroll} ${contentClassName ?? ""}`.trim()}
              >
                {children}
              </Drawer.Content>

              {/* The footer is a sibling of the scroll area, not inside it, so it
                  stays on the sheet's visible bottom edge while the body scrolls
                  and moves 1:1 with the sheet while it is dragged. */}
              {footer ? (
                <div data-base-ui-swipe-ignore className={`${styles.footer} border-t border-line bg-panel px-5 pt-3`}>
                  {footer}
                </div>
              ) : null}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}
