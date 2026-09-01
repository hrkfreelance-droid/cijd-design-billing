"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { CheckIcon, ChevronDown } from "@/components/icons";
import { useI18n } from "@/components/providers";
import type { MessageKey } from "@/lib/i18n";
import type { FlowStatus } from "@/lib/types";

/* --------------------------------------------------------------- button */

type Variant = "primary" | "secondary" | "ghost" | "quiet";

// A disabled primary fades to an inert grey rather than a translucent blue:
// dropping the whole button to 40% left white text on pale blue, which was the
// one place in the app where a filled button became unreadable.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover active:opacity-90 disabled:bg-fill-strong disabled:text-faint disabled:hover:bg-fill-strong",
  secondary:
    "border border-line-strong bg-panel text-text hover:bg-fill active:bg-fill-strong disabled:text-faint disabled:hover:bg-panel",
  ghost: "text-accent hover:bg-fill active:bg-fill-strong disabled:text-faint disabled:hover:bg-transparent",
  quiet: "text-muted hover:bg-fill hover:text-text active:bg-fill-strong disabled:text-faint",
};

export function Button({
  variant = "secondary",
  size = "md",
  full = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  full?: boolean;
}) {
  // One height and one radius per size, and a shared min width so that
  // "Complete" and "Deliver" never end up different widths beside each other.
  return (
    <button
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium transition-colors duration-150 disabled:cursor-not-allowed ${
        size === "sm"
          ? "h-9 px-3.5 text-[12.5px]"
          : "h-10 px-[18px] text-[13.5px]"
      } ${full ? "min-w-0 w-full" : size === "sm" ? "min-w-[84px]" : "min-w-[104px]"} ${
        VARIANTS[variant]
      } ${className}`}
    />
  );
}

export function IconButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-fill hover:text-text ${className}`}
    />
  );
}

/* ------------------------------------------------------------ segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string; short?: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-0.5 rounded-xl bg-fill p-[3px] ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 text-[13px] transition-all duration-150 sm:px-2.5 ${
              active
                ? "bg-raise font-medium text-text shadow-[0_1px_2px_rgba(0,0,0,0.10)]"
                : "text-muted hover:text-text"
            }`}
          >
            <span className="truncate">
              <span className={option.short ? "sm:hidden" : ""}>
                {option.short ?? option.label}
              </span>
              {option.short && <span className="hidden sm:inline">{option.label}</span>}
            </span>
            {option.count !== undefined && (
              <span className={`tnum text-[12px] ${active ? "text-muted" : "text-faint"}`}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- status */

const STATUS_COLOR: Record<FlowStatus, string> = {
  IN_PROGRESS: "bg-progress",
  READY_TO_INVOICE: "bg-ready",
  INVOICED: "bg-awaiting",
  PAID: "bg-paid",
  NEEDS_REVIEW: "bg-review",
};

const STATUS_TEXT: Record<FlowStatus, string> = {
  IN_PROGRESS: "text-muted",
  READY_TO_INVOICE: "text-ready",
  INVOICED: "text-awaiting",
  PAID: "text-paid",
  NEEDS_REVIEW: "text-review",
};

export function StatusTag({
  status,
  className = "",
}: {
  status: FlowStatus;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] ${STATUS_TEXT[status]} ${className}`}
    >
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${STATUS_COLOR[status]}`} />
      {t(`status.${status}`)}
    </span>
  );
}

export type WorkStatus = FlowStatus | "COMPLETED" | "DELIVERED";

const WORK_STATUS_KEY: Record<WorkStatus, MessageKey> = {
  IN_PROGRESS: "status.IN_PROGRESS",
  READY_TO_INVOICE: "status.READY_TO_INVOICE",
  INVOICED: "status.INVOICED",
  PAID: "status.PAID",
  NEEDS_REVIEW: "status.NEEDS_REVIEW",
  COMPLETED: "projects.completed",
  DELIVERED: "projects.delivered",
};

const WORK_STATUS_PILL: Record<WorkStatus, string> = {
  IN_PROGRESS: "bg-fill text-muted",
  READY_TO_INVOICE: "bg-ready/10 text-ready",
  INVOICED: "bg-awaiting/10 text-awaiting",
  PAID: "bg-paid/10 text-paid",
  NEEDS_REVIEW: "bg-review/10 text-review",
  COMPLETED: "bg-paid/10 text-paid",
  DELIVERED: "bg-ready/10 text-ready",
};

/** Compact, text-first status treatment for dense work lists. */
export function StatusPill({
  status,
  className = "",
}: {
  status: WorkStatus;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex h-6 w-fit max-w-full items-center rounded-full px-2.5 text-[11px] font-medium leading-none ${WORK_STATUS_PILL[status]} ${className}`}
    >
      <span className="truncate">{t(WORK_STATUS_KEY[status])}</span>
    </span>
  );
}

export function StatusDot({
  status,
  className = "",
}: {
  status: FlowStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${STATUS_COLOR[status]} ${className}`}
    />
  );
}

/* --------------------------------------------------------------- layout */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-5 pb-5 pt-7 sm:px-8 sm:pt-10">
      <div className="min-w-0 flex-1 basis-[min(100%,14rem)]">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.021em] sm:text-[30px]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function PageTotal({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <div data-testid="page-total" className="shrink-0 text-right">
      <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {t("common.total")}
      </span>
      <span className="tnum block text-[19px] font-semibold leading-tight tracking-[-0.02em]">
        {value}
      </span>
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  meta,
}: {
  title: string;
  hint?: string;
  meta?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-7 sm:px-8">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-faint">{hint}</p>}
      </div>
      {meta && <div className="shrink-0 text-[13px] text-muted">{meta}</div>}
    </div>
  );
}

/** Full-bleed hairline list, the way a settings pane groups rows. */
export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border ${className}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-5 py-12 text-center sm:px-8">
      <p className="text-[14px] text-muted">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-faint">{hint}</p>}
    </div>
  );
}

export function Amount({
  value,
  className = "",
  strong = false,
}: {
  value: string;
  className?: string;
  strong?: boolean;
}) {
  return (
    <span
      className={`tnum whitespace-nowrap ${strong ? "font-semibold" : ""} ${className}`}
    >
      {value}
    </span>
  );
}

/* ---------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {hint && <span className="text-[12px] text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const CONTROL =
  "w-full rounded-xl border border-line-strong bg-panel px-3 text-[15px] text-text placeholder:text-faint transition-colors duration-150 focus:border-accent focus:outline-none";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} h-11 ${className}`} />;
}

export function Select({
  className = "",
  variant = "field",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { variant?: "field" | "filter" }) {
  const shell =
    variant === "filter"
      ? "h-10 rounded-xl bg-fill text-[14px]"
      : `${CONTROL} h-11`;
  return (
    <span className="relative block">
      <select
        {...props}
        className={`w-full appearance-none px-3 pr-9 text-text focus:outline-none ${shell} ${className}`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-[7px] border transition-colors duration-150 ${
        checked
          ? "border-accent bg-accent text-on-accent"
          : "border-line-strong bg-panel text-transparent hover:border-accent"
      }`}
    >
      <CheckIcon className="h-3.5 w-3.5" />
    </button>
  );
}

/* ---------------------------------------------------------------- sheet */

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const field = panel.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]), select, textarea",
    );
    // Typing should start straight away on desktop; on touch we avoid the
    // keyboard jumping up before the sheet has settled.
    if (field && window.matchMedia("(min-width: 640px)").matches) field.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  // Rendered on document.body so no animated or transformed ancestor can
  // become the containing block for the fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="overlay-surface animate-fade absolute inset-0 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-line bg-panel shadow-[0_20px_60px_rgba(0,0,0,0.22)] sm:max-h-[86dvh] sm:w-[440px] sm:rounded-[18px]"
      >
        <div className="shrink-0 px-5 pb-3 pt-5">
          <h2 className="text-[17px] font-semibold tracking-[-0.012em]">{title}</h2>
          {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">{children}</div>
        {footer && (
          <div className="safe-bottom-sheet shrink-0 border-t border-line px-5 pt-4 sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" full onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="pb-2 text-[14px] leading-relaxed text-muted">{message}</p>
    </Sheet>
  );
}
