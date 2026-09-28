"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useI18n } from "@/components/providers";

const NAV = [
  ["/office-v4", "Billing"],
  ["/office-v4/tax-invoices", "Tax Invoices"],
  ["/office-v3/archive", "Records"],
] as const;

export function BillingV4Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale, setLocale } = useI18n();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto flex min-h-[52px] max-w-[1040px] flex-wrap items-center gap-5 px-5 py-2 sm:px-8">
          <Link href="/office-v4" className="text-[15px] font-semibold">CIJD Billing <span className="text-muted">V4</span></Link>
          <nav className="flex min-w-0 flex-1 gap-5 overflow-x-auto text-[13px]">
            {NAV.map(([href, label]) => <Link key={href} href={href} className={pathname === href ? "border-b-2 border-text py-2 font-medium" : "py-2 text-muted hover:text-text"}>{label}</Link>)}
          </nav>
          <div className="flex rounded-full bg-fill p-0.5" aria-label="Language">
            {(["ja", "en", "kh"] as const).map((code) => <button key={code} type="button" aria-pressed={locale === code} onClick={() => setLocale(code)} className={`rounded-full px-2 py-1 text-[11px] font-semibold ${locale === code ? "bg-raise text-text" : "text-muted"}`}>{code}</button>)}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1040px]">{children}</main>
    </div>
  );
}
