"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  ArchiveIcon,
  BillIcon,
  CheckIcon,
  ChevronRight,
  ListIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@/components/icons";
import { api, useData, useI18n, useSession, useTheme } from "@/components/providers";
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
  { href: "/office/progress", key: "nav.progress", Icon: ListIcon },
  { href: "/office", key: "nav.billing", Icon: BillIcon },
  { href: "/office/payments", key: "nav.payments", Icon: ListIcon },
  { href: "/office/archive", key: "nav.archive", Icon: ArchiveIcon },
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
  const [clientsOpen, setClientsOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/signin");
    else if (!canAny(user.role, requires)) router.replace(homeFor(user.role));
  }, [ready, user, requires, router]);

  if (!ready || !user || !canAny(user.role, requires)) {
    return <div className="min-h-dvh bg-bg" />;
  }

  const spaces = workspacesFor(user.role);
  const canManageClients = can(user.role, "client:write");

  return (
    <div className="min-h-dvh bg-bg">
      <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto max-w-4xl">
          <div className="flex min-w-0 items-center justify-between gap-3 px-5 py-3 sm:px-8">
            <Link href={homeFor(user.role)} className="min-w-0 shrink leading-none">
              <span className="block truncate text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
                CIJD
              </span>
              <span className="mt-[3px] block truncate text-[15px] font-semibold tracking-[-0.012em] text-text">
                Billing
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
              <UserMenu />
            </div>
          </div>

          <ServiceBar
            current={workspace}
            spaces={spaces}
            canManageClients={canManageClients}
            onManageClients={() => setClientsOpen(true)}
          />

          <nav aria-label="Workspace navigation" className="border-t border-line">
            <div className="no-scrollbar flex min-w-0 items-center gap-4 overflow-x-auto px-5 sm:px-8">
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
        </div>
      </header>

      <main className="mx-auto max-w-4xl">
        <Content>{children}</Content>
      </main>

      {canManageClients && <ClientsSheet open={clientsOpen} onClose={() => setClientsOpen(false)} />}
    </div>
  );
}

function ServiceBar({
  current,
  spaces,
  canManageClients,
  onManageClients,
}: {
  current: "designer" | "printing" | "office";
  spaces: ("designer" | "printing" | "office")[];
  canManageClients: boolean;
  onManageClients: () => void;
}) {
  const services = [
    { label: "Passport", disabled: true as const },
    { label: "VISA", disabled: true as const },
    { label: "Design", space: "designer" as const, href: "/designer/projects" },
    { label: "Printing", space: "printing" as const, href: "/printing" },
    { label: "Attend", disabled: true as const },
    { label: "Translation", disabled: true as const },
    { label: "Billing", space: "office" as const, href: "/office" },
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

        {canManageClients && (
          <button
            type="button"
            onClick={onManageClients}
            className="ml-1 flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted transition-colors hover:bg-fill hover:text-text"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Clients
          </button>
        )}
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
      />
    </>
  );
}

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
        footer={<Button variant="secondary" full onClick={onClose}>{t("common.close")}</Button>}
      >
        <div className="divide-y divide-line pb-2">
          {clients.map((client) => (
            <button
              key={client.id}
              onClick={() => setEditing(client)}
              className="flex w-full items-center gap-3 py-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[15px]">{client.name}</span>
              {!client.active && <span className="text-[12px] text-faint">{t("client.hidden")}</span>}
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
  const { run, busy } = useAction();
  const [name, setName] = useState(client?.name ?? "");

  const submit = async () => {
    if (!name.trim()) return;
    const ok = await run(
      () => client
        ? api(`/api/clients/${client.id}`, { method: "PATCH", body: { name } })
        : api("/api/clients", { method: "POST", body: { name } }),
      { key: client ? "toast.itemUpdated" : "toast.clientCreated" },
    );
    if (ok) onClose();
  };

  const toggleActive = async () => {
    if (!client) return;
    const ok = await run(
      () => api(`/api/clients/${client.id}`, { method: "PATCH", body: { active: !client.active } }),
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={client ? t("client.edit") : t("client.new")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" full onClick={submit} disabled={!name.trim() || busy}>{t("common.save")}</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t("client.name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("client.namePlaceholder")}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
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
