"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { MoonIcon, SunIcon } from "@/components/icons";
import { useData, useI18n, useSession, useTheme } from "@/components/providers";
import { Button, IconButton, Sheet } from "@/components/ui";
import { canAny, homeFor } from "@/lib/auth/roles";

/**
 * Billing V2 is one screen, not a set of workspaces.
 *
 * Design and Printing are line items inside a project, so there is nothing to
 * switch between: the only choice in this chrome is whether you are looking at
 * work waiting to be billed, or work already billed. Everything else the old
 * workspaces carried — client filters, progress, accounting, printing — is
 * deliberately absent.
 */
const TABS = [
  { href: "/office-v2", key: "v2.nav.billing" },
  { href: "/office-v2/archive", key: "v2.nav.archive" },
] as const;

export function BillingV2Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/signin");
    else if (!canAny(user.role, ["billing:read", "billing:price:write"])) {
      router.replace(homeFor(user.role));
    }
  }, [ready, user, router]);

  if (!ready || !user || !canAny(user.role, ["billing:read", "billing:price:write"])) {
    return <div className="min-h-dvh bg-bg" />;
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto max-w-[860px] px-5 sm:px-8">
          <div className="flex min-w-0 items-center justify-between gap-4 py-3">
            <Link href="/office-v2" className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.012em]">
              {t("v2.brand")}
            </Link>

            <div className="flex shrink-0 items-center gap-1">
              <div className="flex items-center rounded-full bg-fill p-[2px]">
                {(["ja", "en", "kh"] as const).map((code) => (
                  <button
                    key={code}
                    onClick={() => setLocale(code)}
                    aria-label={code === "ja" ? "日本語" : code === "kh" ? "ខ្មែរ" : "English"}
                    aria-pressed={locale === code}
                    className={`h-7 rounded-full px-2.5 text-[11.5px] font-medium uppercase tracking-wide transition-colors duration-150 ${
                      locale === code
                        ? "bg-raise text-text shadow-[0_1px_2px_rgba(0,0,0,0.10)]"
                        : "text-faint hover:text-muted"
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <IconButton
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={t("theme.toggle")}
                title={t(theme === "dark" ? "theme.light" : "theme.dark")}
              >
                {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              </IconButton>
              <AccountMenu />
            </div>
          </div>

          <nav aria-label="Billing navigation" className="-mb-px flex items-center gap-5">
            {TABS.map(({ href, key }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-10 shrink-0 items-center border-b-2 px-0.5 text-[13px] font-medium transition-colors duration-150 ${
                    active ? "border-accent text-text" : "border-transparent text-faint hover:text-text"
                  }`}
                >
                  {t(key)}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[860px]">
        <Content>{children}</Content>
      </main>
    </div>
  );
}

function Content({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { snapshot, error, refresh } = useData();
  if (error && !snapshot) {
    return (
      <div className="px-5 pt-20 text-center sm:px-8">
        <p className="text-[14px] text-muted">{t("error.offline")}</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            void refresh();
          }}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

function AccountMenu() {
  const { t } = useI18n();
  const { user, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={user.name}
        className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-muted transition-colors hover:bg-fill-strong hover:text-text"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={user.name}
        description={t(`role.${user.role}`)}
        footer={
          <div className="space-y-2">
            <Button variant="secondary" full onClick={() => setOpen(false)}>
              {t("common.close")}
            </Button>
            <button
              onClick={() => {
                void signOut().then(() => router.push("/signin"));
              }}
              className="block w-full py-1.5 text-center text-[13px] text-faint transition-colors hover:text-review"
            >
              {t("signin.signOut")}
            </button>
          </div>
        }
      />
    </>
  );
}
