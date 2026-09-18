"use client";

import { Popover } from "@base-ui/react/popover";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { MoonIcon, SunIcon } from "@/components/icons";
import { useData, useI18n, useSession, useTheme } from "@/components/providers";
import { Button, IconButton } from "@/components/ui";
import { canAny, homeFor } from "@/lib/auth/roles";

/**
 * Billing V2 is one workspace, not a set of them.
 *
 * Design and Printing are line items inside a project, so there is nothing to
 * switch between: the only choice in this chrome is whether you are looking at
 * work waiting to be billed, or work already billed. The header is one line on
 * a desktop — name, the two places, then language, theme and account — and
 * splits the two places onto their own line on a phone.
 */
const TABS = [
  { href: "/office-v3", key: "v2.nav.billing" },
  { href: "/office-v3/archive", key: "v2.nav.archive" },
] as const;

export function BillingV3Shell({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  const router = useRouter();
  const allowed = !!user && canAny(user.role, ["billing:read", "billing:price:write"]);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/signin");
    else if (!allowed) router.replace(homeFor(user.role));
  }, [ready, user, allowed, router]);

  return (
    <div className="min-h-dvh bg-bg">
      <Header />
      <main className="mx-auto max-w-[960px]">
        {ready && allowed ? <Content>{children}</Content> : <BoardSkeleton />}
      </main>
    </div>
  );
}

function Header() {
  const pathname = usePathname();
  const { t } = useI18n();

  const tabs = (
    <>
      {TABS.map(({ href, key }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-full shrink-0 items-center border-b-2 text-[13.5px] font-medium transition-colors duration-150 ${
              active ? "border-text text-text" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t(key)}
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
      <div className="mx-auto flex h-[52px] max-w-[960px] items-stretch gap-7 px-5 sm:px-8">
        <Link
          href="/office-v3"
          className="flex shrink-0 items-center text-[15px] font-semibold tracking-[-0.015em]"
          data-testid="v2-brand"
        >
          {t("v2.brand")}
        </Link>
        <nav aria-label="Billing" className="-mb-px hidden items-stretch gap-6 sm:flex">
          {tabs}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <LanguageSwitch />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
      <nav aria-label="Billing" className="-mb-px flex h-10 items-stretch gap-6 px-5 sm:hidden">
        {tabs}
      </nav>
    </header>
  );
}

function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="flex items-center rounded-full bg-fill p-[2px]">
      {(["ja", "en", "kh"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          aria-label={code === "ja" ? "日本語" : code === "kh" ? "ខ្មែរ" : "English"}
          aria-pressed={locale === code}
          className={`h-7 min-w-8 rounded-full px-2 text-[11px] font-semibold uppercase tracking-[0.04em] transition-colors duration-150 ${
            locale === code ? "bg-raise text-text shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted hover:text-text"
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <IconButton
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={t("theme.toggle")}
      title={t(theme === "dark" ? "theme.light" : "theme.dark")}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}

function Content({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { snapshot, error, refresh } = useData();
  const [retrying, setRetrying] = useState(false);
  if (error && !snapshot) {
    return (
      <div className="px-5 pt-24 text-center sm:px-8">
        <p className="text-[15px] font-medium">{t("v2.loadFailed")}</p>
        <p className="mt-1 text-[13.5px] text-muted">{t("error.offline")}</p>
        <Button
          variant="secondary"
          className="mt-5"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void refresh().finally(() => setRetrying(false));
          }}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

/** The shape of the Billing list while it loads, so nothing jumps when it arrives. */
export function BoardSkeleton() {
  return (
    <div className="animate-fade px-5 pt-6 sm:px-8 sm:pt-8" aria-hidden>
      <div className="h-8 w-32 rounded-lg bg-fill" />
      <div className="mt-2.5 h-4 w-60 max-w-full rounded bg-fill" />
      <div className="mt-7 flex gap-12">
        <div className="h-10 w-28 rounded-lg bg-fill" />
        <div className="h-10 w-24 rounded-lg bg-fill" />
      </div>
      <div className="mt-12 h-3 w-24 rounded bg-fill" />
      <div className="mt-5 space-y-5">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="border-b border-line pb-5">
            <div className="flex justify-between gap-6">
              <div className="h-4 w-1/2 rounded bg-fill" />
              <div className="h-4 w-16 rounded bg-fill" />
            </div>
            <div className="mt-3 h-3 w-2/3 rounded bg-fill" />
            <div className="mt-2 h-3 w-1/2 rounded bg-fill" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountMenu() {
  const { t } = useI18n();
  const { user, signOut } = useSession();
  const router = useRouter();
  if (!user) return <span className="ml-0.5 h-8 w-8 rounded-full bg-fill" aria-hidden />;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={user.name}
        className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-muted transition-colors hover:bg-fill-strong hover:text-text data-[popup-open]:bg-fill-strong data-[popup-open]:text-text"
        data-testid="v2-account"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="account-popup w-56 rounded-2xl border border-line bg-panel p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.18)]">
            <div className="px-3 pb-2.5 pt-2">
              <Popover.Title className="truncate text-[14px] font-semibold">{user.name}</Popover.Title>
              <Popover.Description className="mt-0.5 text-[12.5px] text-muted">{t(`role.${user.role}`)}</Popover.Description>
            </div>
            <div className="border-t border-line pt-1">
              <button
                type="button"
                onClick={() => {
                  void signOut().then(() => router.push("/signin"));
                }}
                className="flex h-10 w-full items-center rounded-xl px-3 text-left text-[13.5px] text-text transition-colors hover:bg-fill"
              >
                {t("signin.signOut")}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
