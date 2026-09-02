import type { ReactNode } from "react";

export function CompactSummaryHeader({
  title,
  subtitle,
  label,
  value,
  secondaryValue,
  meta,
}: {
  title: string;
  subtitle?: ReactNode;
  label?: ReactNode;
  value?: ReactNode;
  secondaryValue?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="flex min-w-0 items-start justify-between gap-4 px-4 pb-5 pt-5 sm:px-8 sm:pb-4 sm:pt-6">
      <div className="min-w-0 flex-1">
        <h1 className="text-[28px] font-semibold leading-[1.04] tracking-[-0.025em] text-text sm:text-[30px] sm:leading-tight">
          {title}
        </h1>
        {subtitle ? <p className="mt-1.5 text-[13.5px] leading-snug text-muted sm:mt-1">{subtitle}</p> : null}
      </div>

      {value !== undefined ? (
        <div className="shrink-0 pt-0.5 text-right">
          {label ? (
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{label}</p>
          ) : null}
          <div className="tnum mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-text">
            {value}
          </div>
          {secondaryValue ? (
            <div className="tnum mt-0.5 text-[11px] leading-tight text-faint">{secondaryValue}</div>
          ) : null}
          {meta ? <div className="mt-0.5 text-[10.5px] leading-tight text-review">{meta}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
