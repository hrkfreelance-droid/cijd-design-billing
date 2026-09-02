"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ArchiveIcon,
  BillIcon,
  CheckIcon,
  ChevronRight,
  ListIcon,
  MoonIcon,
  SunIcon,
} from "@/components/icons";
import { useData, useI18n, useSession, useTheme } from "@/components/providers";
import { Button, IconButton, Sheet } from "@/components/ui";
import { canAny, homeFor, workspacesFor, type Permission } from "@/lib/auth/roles";
import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  href: string;
  key: MessageKey;
  Icon: typeof ListIcon;
  requires?: Permission[];
}

export const DESIGNER_NAV: NavItem[] = [
  { href: "/designer/projects", key: "nav.design", Icon: ListIcon },
  { href: "/designer/delivered", key: "nav.delivered", Icon: CheckIcon },
  { href: "/designer/archive", key: "nav.archive", Icon: ArchiveIcon },
];

export const OFFICE_NAV: NavItem[] = [
  { href: "/office/progress", key: "nav.progress", Icon: ListIcon, requires: ["progress:read"] },
  { href: "/office", key: "nav.billing", Icon: BillIcon, requires: ["billing:read"] },
  { href: "/office/payments", key: "nav.payments", Icon: ListIcon, requires: ["payment:read"] },
  { href: "/office/archive", key: "nav.archive", Icon: ArchiveIcon, requires: ["payment:read"] },
];

export const PRINTING_NAV: NavItem[] = [
  { href: "/printing", key: "nav.printingHome", Icon: ListIcon },
  { href: "/printing/history", key: "nav.printHistory", Icon: ArchiveIcon },
];

function isActive(pathname: string, href: string, nav: NavItem[]) {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !nav.some((item) => item.href !== href && pathname.startsWith(item.href));
}

function workspaceTitle(workspace: "designer" | "printing" | "office") {
  if (workspace === "designer") return "Design";
  if (workspace === "printing") return "Printing";
  return "Billing";
}

export function Workspace({
  nav,
  workspace,
  requires,
  children,
}: {
  nav: NavItem[];
  workspace: "designer" | "printing" | "office";
  requires: Permission[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/signin");
    else if (!canAny(user.role, requires)) router.replace(homeFor(user.role));
  }, [ready, user, requires, router]);

  const visibleNav = useMemo(
    () => user ? nav.filter((item) => !item.requires || canAny(user.role, item.requires)) : [],
    [nav, user],
  );

  if (!ready || !user || !canAny(user.role, requires)) {
    return <div className="min-h-dvh bg-bg" />;
  }

  const spaces = workspacesFor(user.role);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto max-w-4xl">
          <div className="flex min-w-0 items-center justify-between gap-3 px-5 py-3 sm:px-8">
            <Link href={homeFor(user.role)} className="min-w-0 shrink leading-none">
              <span className="block truncate text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</span>
              <span className="mt-[3px] block truncate text-[15px] font-semibold tracking-[-0.012em] text-text">
                {workspaceTitle(workspace)}
              </span>
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
              <UserMenu workspace={workspace} />
            </div>
          </div>

          {workspace !== "office" && <ServiceBar current={workspace} spaces={spaces} />}

          <nav aria-label="Workspace navigation" className="border-t border-line">
            <div className="no-scrollbar flex min-w-0 items-center gap-4 overflow-x-auto px-5 sm:px-8">
              {visibleNav.map(({ href, key }) => {
                const active = isActive(pathname, href, visibleNav);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-10 shrink-0 items-center border-b-2 px-0.5 text-[12px] font-medium transition-colors duration-150 ${
                      active ? "border-accent text-text" : "border-transparent text-faint hover:text-text"
                    }`}
                  >
                    {t(key)}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl">
        <Content>{children}</Content>
      </main>
    </div>
  );
}

function ServiceBar({
  current,
  spaces,
}: {
  current: "designer" | "printing";
  spaces: ("designer" | "printing" | "office")[];
}) {
  const services = [
    { label: "Passport", disabled: true as const },
    { label: "VISA", disabled: true as const },
    { label: "Design", space: "designer" as const, href: "/designer/projects" },
    { label: "Printing", space: "printing" as const, href: "/printing" },
    { label: "Attend", disabled: true as const },
    { label: "Translation", disabled: true as const },
  ];

  return (
    <div className="border-t border-line">
      <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto px-5 py-2 sm:px-8">
        {services.map((service) => {
          if ("disabled" in service) {
            return (
              <button
                key={service.label}
                type="button"
                disabled
                aria-disabled="true"
                className="h-7 shrink-0 cursor-not-allowed rounded-full bg-fill/55 px-3 text-[12px] font-medium text-faint/45"
              >
                {service.label}
              </button>
            );
          }
          const enabled = spaces.includes(service.space);
          const active = current === service.space;
          if (!enabled) {
            return (
              <button
                key={service.label}
                type="button"
                disabled
                aria-disabled="true"
                className="h-7 shrink-0 cursor-not-allowed rounded-full px-3 text-[12px] font-medium text-faint/35"
              >
                {service.label}
              </button>
            );
          }
          return (
            <Link
              key={service.label}
              href={service.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-7 shrink-0 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
                active ? "bg-accent/10 text-accent" : "text-muted hover:bg-fill hover:text-text"
              }`}
            >
              {service.label}
            </Link>
          );
        })}
      </div>
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
        <Button variant="secondary" className="mt-4" onClick={() => void refresh()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

function UserMenu({ workspace }: { workspace: "designer" | "printing" | "office" }) {
  const { t } = useI18n();
  const { user, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const adminLinks = user.role === "ADMIN"
    ? [
        { href: "/designer/projects", label: "Design", active: workspace === "designer" },
        { href: "/printing", label: "Printing", active: workspace === "printing" },
        { href: "/office", label: "Billing", active: workspace === "office" },
        { href: "/admin", label: "Admin", active: false },
      ]
    : [];

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
            <Button variant="secondary" full onClick={() => setOpen(false)}>{t("common.close")}</Button>
            <button
              onClick={() => void signOut().then(() => router.push("/signin"))}
              className="block w-full py-1.5 text-center text-[13px] text-faint transition-colors hover:text-review"
            >
              {t("signin.signOut")}
            </button>
          </div>
        }
      >
        {adminLinks.length > 0 && (
          <div className="divide-y divide-line pb-2">
            {adminLinks.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
                className="flex min-h-11 w-full items-center gap-3 py-3 text-left"
              >
                <span className={`flex-1 text-[15px] ${item.active ? "font-medium text-accent" : "text-text"}`}>{item.label}</span>
                <ChevronRight className="h-4 w-4 text-faint" />
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}
