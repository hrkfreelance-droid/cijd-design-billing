"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  ArchiveIcon,
  BillIcon,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  ListIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@/components/icons";
import {
  api,
  useClientFilter,
  useData,
  useI18n,
  useSession,
  useTheme,
} from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, Field, IconButton, Input, Sheet } from "@/components/ui";
import { can, canAny, homeFor, workspacesFor, type Permission } from "@/lib/auth/roles";
import type { MessageKey } from "@/lib/i18n";
import type { Client } from "@/lib/types";

export interface NavItem {
  href: string;
  key: MessageKey;
  Icon: typeof ListIcon;
}

export const DESIGNER_NAV: NavItem[] = [
  { href: "/designer/projects", key: "nav.design", Icon: ListIcon },
  { href: "/designer/delivered", key: "nav.delivered", Icon: CheckIcon },
  { href: "/designer/archive", key: "nav.archive", Icon: ArchiveIcon },
];

export const OFFICE_NAV: NavItem[] = [
  { href: "/office", key: "nav.billing", Icon: BillIcon },
  { href: "/office/payments", key: "nav.payments", Icon: ListIcon },
  { href: "/office/progress", key: "nav.progress", Icon: ListIcon },
  { href: "/office/archive", key: "nav.archive", Icon: ArchiveIcon },
];

export const PRINTING_NAV: NavItem[] = [
  { href: "/printing", key: "nav.printingHome", Icon: ListIcon },
  { href: "/printing/history", key: "nav.printHistory", Icon: ArchiveIcon },
];

function isActive(pathname: string, href: string, nav: NavItem[]) {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // A nested nav item wins over its parent.
  return !nav.some((item) => item.href !== href && pathname.startsWith(item.href));
}

export function Workspace({
  nav,
  workspace,
  requires,
  children,
}: {
  nav: NavItem[];
  workspace: "designer" | "printing" | "office";
  /** Checked again in the browser, on top of the server side guard. */
  requires: Permission[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, ready, auth } = useSession();
  const { snapshot } = useData();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/signin");
    else if (!canAny(user.role, requires)) router.replace(homeFor(user.role));
  }, [ready, user, requires, router]);

  if (!ready || !user || !canAny(user.role, requires)) {
    return <div className="min-h-dvh bg-bg" />;
  }

  const mode = snapshot?.mode ?? (auth === "supabase" ? "supabase" : "local");
  const showMode = mode === "supabase" && (process.env.NODE_ENV !== "production" || user.role === "ADMIN");
  const spaces = workspacesFor(user.role);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="min-w-0 shrink-0 leading-none">
            <span className="block text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
              {t("brand.company")}
            </span>
            <WorkspaceSelector current={workspace} spaces={spaces} />
          </div>

          <nav aria-label="Workspace navigation" className="hidden items-center gap-1 sm:flex">
            {nav.map(({ href, key }) => {
              const active = isActive(pathname, href, nav);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors duration-150 ${
                    active ? "bg-fill font-medium text-text" : "text-muted hover:text-text"
                  }`}
                >
                  {t(key)}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            {showMode && <ModeBadge mode={mode} className="hidden sm:inline-flex" />}
            <div className="flex items-center rounded-full bg-fill p-[2px]">
              {(["ja", "en"] as const).map((code) => (
                <button
                  key={code}
                  onClick={() => setLocale(code)}
                  aria-label={code === "ja" ? "日本語" : "English"}
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
            <UserMenu />
          </div>
        </div>
        <ClientBar canAdd={workspace === "designer"} />
      </header>

      <nav
        aria-label="Workspace navigation"
        className="mx-auto max-w-4xl border-t border-line sm:hidden"
      >
        <div className="no-scrollbar flex items-center gap-4 overflow-x-auto px-5 sm:px-8">
          {nav.map(({ href, key }) => {
            const active = isActive(pathname, href, nav);
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

      <main className="mx-auto max-w-4xl">
        <Content>{children}</Content>
      </main>
    </div>
  );
}

function ModeBadge({ mode, className = "" }: { mode: "local" | "supabase"; className?: string }) {
  const label = mode === "supabase" ? "PRODUCTION / SUPABASE" : "LOCAL MODE";
  return (
    <span
      data-testid="data-mode"
      aria-label={`Data mode: ${label}`}
      className={`items-center rounded-full border border-line px-2 py-1 text-[9px] font-medium uppercase tracking-[0.08em] text-faint ${className}`}
    >
      {label}
    </span>
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

function UserMenu() {
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
      >
      </Sheet>
    </>
  );
}

function workspaceHref(space: "designer" | "printing" | "office") {
  return space === "designer" ? "/designer/projects" : space === "printing" ? "/printing" : "/office";
}

function workspaceLabel(
  t: (key: MessageKey) => string,
  space: "designer" | "printing" | "office",
) {
  return t(
    space === "designer"
      ? "workspace.designer"
      : space === "printing"
        ? "workspace.printing"
        : "workspace.office",
  );
}

function WorkspaceSelector({
  current,
  spaces,
}: {
  current: "designer" | "printing" | "office";
  spaces: ("designer" | "printing" | "office")[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const label = workspaceLabel(t, current);

  if (spaces.length <= 1) {
    return (
      <Link
        href={workspaceHref(current)}
        className="mt-[3px] block truncate text-[15px] font-semibold tracking-[-0.012em]"
      >
        {label}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${label} — ${t("workspace.switch")}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="mt-[3px] flex max-w-[180px] items-center gap-1 truncate text-left text-[15px] font-semibold tracking-[-0.012em]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("workspace.switch")}
        footer={
          <Button variant="secondary" full onClick={() => setOpen(false)}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="divide-y divide-line pb-2">
          {spaces.map((space) => (
            <button
              key={space}
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(workspaceHref(space));
              }}
              className="flex min-h-11 w-full items-center gap-3 py-3 text-left"
            >
              <span className="flex-1 text-[15px]">{workspaceLabel(t, space)}</span>
              {space === current ? (
                <CheckIcon className="h-4 w-4 text-accent" />
              ) : (
                <ChevronRight className="h-4 w-4 text-faint" />
              )}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function ClientBar({ canAdd }: { canAdd: boolean }) {
  const { t } = useI18n();
  const { snapshot } = useData();
  const { clientId, setClientId } = useClientFilter();
  const { user } = useSession();
  const [managing, setManaging] = useState(false);
  const clients = (snapshot?.clients ?? []).filter((client) => client.active);
  const allowed = canAdd && !!user && can(user.role, "client:write");

  return (
    <>
      <div className="mx-auto max-w-4xl">
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-5 pb-2.5 sm:px-8">
          <ClientChip
            label={t("client.all")}
            active={clientId === null}
            onClick={() => setClientId(null)}
          />
          {clients.map((client) => (
            <ClientChip
              key={client.id}
              label={client.name}
              active={clientId === client.id}
              onClick={() => setClientId(client.id)}
            />
          ))}
          {allowed && (
            <button
              onClick={() => setManaging(true)}
              aria-label={t("client.manage")}
              title={t("client.manage")}
              className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors duration-150 hover:bg-fill hover:text-text"
            >
              <PlusIcon className="h-[15px] w-[15px]" />
            </button>
          )}
        </div>
      </div>
      {allowed && <ClientsSheet open={managing} onClose={() => setManaging(false)} />}
    </>
  );
}

function ClientChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12.5px] transition-colors duration-150 ${
        active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-fill hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

/** Add and rename clients, or hide the ones that are no longer active. */
function ClientsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { snapshot } = useData();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const clients = snapshot?.clients ?? [];

  return (
    <>
      <Sheet
        open={open && editing === null}
        onClose={onClose}
        title={t("client.manage")}
        footer={
          <Button variant="secondary" full onClick={onClose}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="divide-y divide-line pb-2">
          {clients.map((client) => (
            <button
              key={client.id}
              onClick={() => setEditing(client)}
              className="flex w-full items-center gap-3 py-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[15px]">{client.name}</span>
              {!client.active && (
                <span className="text-[12px] text-faint">{t("client.hidden")}</span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
            </button>
          ))}
          <button
            onClick={() => setEditing("new")}
            className="flex w-full items-center gap-2 py-3 text-left text-[14.5px] font-medium text-accent"
          >
            <PlusIcon className="h-4 w-4" />
            {t("client.new")}
          </button>
        </div>
      </Sheet>

      <ClientEditSheet
        key={editing === "new" ? "new" : (editing?.id ?? "none")}
        open={editing !== null}
        client={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ClientEditSheet({
  open,
  client,
  onClose,
}: {
  open: boolean;
  client: Client | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { setClientId } = useClientFilter();
  const { run, busy } = useAction();
  const [name, setName] = useState(client?.name ?? "");

  const submit = async () => {
    if (!name.trim()) return;
    if (client) {
      const ok = await run(
        () => api(`/api/clients/${client.id}`, { method: "PATCH", body: { name } }),
        { key: "toast.itemUpdated" },
      );
      if (ok) onClose();
      return;
    }
    let created: { id: string } | null = null;
    const ok = await run(async () => {
      created = await api<{ id: string }>("/api/clients", { method: "POST", body: { name } });
    }, { key: "toast.clientCreated" });
    if (ok && created) {
      setClientId((created as { id: string }).id);
      onClose();
    }
  };

  const toggleActive = async () => {
    if (!client) return;
    const ok = await run(
      () =>
        api(`/api/clients/${client.id}`, {
          method: "PATCH",
          body: { active: !client.active },
        }),
      { key: "toast.itemUpdated" },
    );
    if (ok) {
      if (client.active) setClientId(null);
      onClose();
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={client ? t("client.edit") : t("client.new")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" full onClick={submit} disabled={!name.trim() || busy}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t("client.name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("client.namePlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </Field>
        {client && (
          <button
            onClick={toggleActive}
            disabled={busy}
            className="block w-full border-t border-line py-3 text-center text-[13px] text-muted transition-colors hover:text-text"
          >
            {t(client.active ? "client.hide" : "client.show")}
          </button>
        )}
      </div>
    </Sheet>
  );
}
