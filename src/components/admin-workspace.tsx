"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ChevronRight, MoonIcon, PlusIcon, SunIcon } from "@/components/icons";
import { api, useData, useI18n, useSession, useTheme, useToast } from "@/components/providers";
import { Button, EmptyState, Field, IconButton, Input, Segmented, Select, Sheet } from "@/components/ui";
import { homeFor, type Role } from "@/lib/auth/roles";
import type { Client } from "@/lib/types";

type AdminTab = "people" | "clients";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
};

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "DESIGNER", label: "Design" },
  { value: "PRINTING", label: "Printing" },
  { value: "BILLING", label: "Billing" },
  { value: "ACCOUNTING", label: "Accounting" },
  { value: "ADMIN", label: "Admin" },
];

const COPY = {
  ja: {
    admin: "管理",
    people: "ユーザー",
    clients: "クライアント",
    back: "戻る",
    subtitle: "アカウントと基本データをここで管理します",
    newUser: "新しいユーザー",
    newClient: "新しいクライアント",
    active: "有効",
    inactive: "停止中",
    name: "名前",
    email: "メールアドレス",
    role: "権限",
    tempPassword: "初期パスワード",
    passwordHint: "本人へ安全に共有してください。作成後は再表示されません",
    regenerate: "再生成",
    copy: "コピー",
    copied: "コピーしました",
    create: "作成",
    save: "保存",
    cancel: "キャンセル",
    userCreated: "ユーザーを作成しました",
    userUpdated: "ユーザーを更新しました",
    clientCreated: "クライアントを追加しました",
    clientUpdated: "クライアントを更新しました",
    noUsers: "ユーザーがいません",
    noClients: "クライアントがいません",
    accountStatus: "アカウント状態",
    projects: "案件",
    masterData: "基本データ",
    loginHint: "新規ユーザーは登録メールアドレスと初期パスワードでログインします",
  },
  en: {
    admin: "Admin",
    people: "People",
    clients: "Clients",
    back: "Back",
    subtitle: "Manage accounts and master data in one place",
    newUser: "New user",
    newClient: "New client",
    active: "Active",
    inactive: "Inactive",
    name: "Name",
    email: "Email",
    role: "Role",
    tempPassword: "Temporary password",
    passwordHint: "Share it securely. It is not shown again after creation",
    regenerate: "Regenerate",
    copy: "Copy",
    copied: "Copied",
    create: "Create",
    save: "Save",
    cancel: "Cancel",
    userCreated: "User created",
    userUpdated: "User updated",
    clientCreated: "Client added",
    clientUpdated: "Client updated",
    noUsers: "No users yet",
    noClients: "No clients yet",
    accountStatus: "Account status",
    projects: "projects",
    masterData: "Master data",
    loginHint: "New users sign in with their registered email and temporary password",
  },
} as const;

function copyFor(locale: string) {
  return locale === "ja" ? COPY.ja : COPY.en;
}

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

export function AdminWorkspace() {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user } = useSession();
  const { snapshot, refresh } = useData();
  const { toast } = useToast();
  const c = copyFor(locale);
  const [tab, setTab] = useState<AdminTab>("people");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userSheet, setUserSheet] = useState<AdminUser | "new" | null>(null);
  const [clientSheet, setClientSheet] = useState<Client | "new" | null>(null);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      setUsers(await api<AdminUser[]>("/api/admin/users"));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load users.", "error");
    } finally {
      setLoadingUsers(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const clients = useMemo(
    () => [...(snapshot?.clients ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot?.clients],
  );
  const projectCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of snapshot?.projects ?? []) {
      map.set(project.clientId, (map.get(project.clientId) ?? 0) + 1);
    }
    return map;
  }, [snapshot?.projects]);

  if (!user) return <div className="min-h-dvh bg-bg" />;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
          <div className="min-w-0 leading-none">
            <span className="block text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</span>
            <span className="mt-[3px] block text-[15px] font-semibold tracking-[-0.012em]">{c.admin}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex items-center rounded-full bg-fill p-[2px]">
              {(["ja", "en", "kh"] as const).map((code) => (
                <button
                  key={code}
                  onClick={() => setLocale(code)}
                  aria-pressed={locale === code}
                  className={`h-7 rounded-full px-2.5 text-[11.5px] font-medium uppercase tracking-wide ${
                    locale === code ? "bg-raise text-text shadow-[0_1px_2px_rgba(0,0,0,0.10)]" : "text-faint"
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
            <IconButton onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("theme.toggle")}>
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </IconButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl pb-16">
        <div className="px-5 pb-3 pt-6 sm:px-8 sm:pt-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{c.admin}</h1>
              <p className="mt-1 text-[13.5px] text-muted">{c.subtitle}</p>
            </div>
            <Link
              href={homeFor(user.role)}
              className="inline-flex h-9 items-center rounded-full border border-line-strong bg-panel px-4 text-[12.5px] font-medium text-muted transition-colors hover:bg-fill hover:text-text"
            >
              {c.back}
            </Link>
          </div>
          <div className="mt-6 max-w-sm">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "people", label: c.people, count: users.filter((item) => item.active).length },
                { value: "clients", label: c.clients, count: clients.filter((item) => item.active).length },
              ]}
            />
          </div>
        </div>

        {tab === "people" ? (
          <section>
            <div className="flex items-end justify-between gap-4 px-5 pb-2 pt-5 sm:px-8">
              <div>
                <h2 className="text-[15px] font-semibold">{c.people}</h2>
                <p className="mt-0.5 text-[12.5px] text-faint">{c.loginHint}</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setUserSheet("new")}>
                <PlusIcon className="h-3.5 w-3.5" />
                {c.newUser}
              </Button>
            </div>
            <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
              {loadingUsers ? (
                <div className="px-5 py-8 text-[13px] text-faint">Loading…</div>
              ) : users.length === 0 ? (
                <EmptyState title={c.noUsers} />
              ) : (
                users.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setUserSheet(item)}
                    className="flex min-h-[68px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-fill"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-muted">
                      {item.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14.5px] font-medium">{item.name}</span>
                        {!item.active && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-[10.5px] text-faint">{c.inactive}</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-faint">{item.email}</span>
                    </span>
                    <span className="hidden shrink-0 text-[12px] font-medium text-muted sm:block">
                      {ROLE_OPTIONS.find((role) => role.value === item.role)?.label ?? item.role}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                  </button>
                ))
              )}
            </div>
          </section>
        ) : (
          <section>
            <div className="flex items-end justify-between gap-4 px-5 pb-2 pt-5 sm:px-8">
              <div>
                <h2 className="text-[15px] font-semibold">{c.clients}</h2>
                <p className="mt-0.5 text-[12.5px] text-faint">{c.masterData}</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setClientSheet("new")}>
                <PlusIcon className="h-3.5 w-3.5" />
                {c.newClient}
              </Button>
            </div>
            <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
              {clients.length === 0 ? (
                <EmptyState title={c.noClients} />
              ) : (
                clients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => setClientSheet(client)}
                    className="flex min-h-[60px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-fill"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14.5px] font-medium">{client.name}</span>
                        {!client.active && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-[10.5px] text-faint">{c.inactive}</span>}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] text-faint">{projectCount.get(client.id) ?? 0} {c.projects}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                  </button>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      <UserSheet
        key={userSheet === "new" ? "new-user" : userSheet?.id ?? "none-user"}
        value={userSheet}
        locale={locale}
        currentUserId={user.id}
        onClose={() => setUserSheet(null)}
        onSaved={async () => {
          await loadUsers();
          setUserSheet(null);
        }}
      />
      <ClientSheet
        key={clientSheet === "new" ? "new-client" : clientSheet?.id ?? "none-client"}
        value={clientSheet}
        locale={locale}
        onClose={() => setClientSheet(null)}
        onSaved={async () => {
          await refresh();
          setClientSheet(null);
        }}
      />
    </div>
  );
}

function UserSheet({
  value,
  locale,
  currentUserId,
  onClose,
  onSaved,
}: {
  value: AdminUser | "new" | null;
  locale: string;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const c = copyFor(locale);
  const existing = value && value !== "new" ? value : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [role, setRole] = useState<Role>(existing?.role ?? "DESIGNER");
  const [active, setActive] = useState(existing?.active ?? true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (value === "new" && !password) setPassword(temporaryPassword());
  }, [password, value]);

  const save = async () => {
    if (!value || busy) return;
    setBusy(true);
    try {
      if (value === "new") {
        await api("/api/admin/users", { method: "POST", body: { name, email, role, password } });
        toast(c.userCreated);
      } else {
        await api(`/api/admin/users/${value.id}`, { method: "PATCH", body: { name, role, active } });
        toast(c.userUpdated);
      }
      await onSaved();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save user.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={value !== null}
      onClose={onClose}
      title={value === "new" ? c.newUser : existing?.name ?? c.people}
      description={existing?.email}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose} disabled={busy}>{c.cancel}</Button>
          <Button
            variant="primary"
            full
            onClick={() => void save()}
            disabled={busy || !name.trim() || (value === "new" && (!email.trim() || password.length < 8))}
          >
            {value === "new" ? c.create : c.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={c.name}>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
        <Field label={c.email}>
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={value !== "new"} autoComplete="off" />
        </Field>
        <Field label={c.role}>
          <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>

        {value === "new" ? (
          <Field label={c.tempPassword} hint={c.passwordHint}>
            <div className="space-y-2">
              <Input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPassword(temporaryPassword())}>{c.regenerate}</Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(password).then(() => toast(c.copied))}
                  disabled={!password}
                >
                  {c.copy}
                </Button>
              </div>
            </div>
          </Field>
        ) : (
          <Field label={c.accountStatus}>
            <div className="flex rounded-xl bg-fill p-[3px]">
              <button
                type="button"
                onClick={() => setActive(true)}
                className={`h-9 flex-1 rounded-[9px] text-[13px] ${active ? "bg-raise font-medium shadow-[0_1px_2px_rgba(0,0,0,0.10)]" : "text-muted"}`}
              >
                {c.active}
              </button>
              <button
                type="button"
                onClick={() => setActive(false)}
                disabled={existing?.id === currentUserId}
                className={`h-9 flex-1 rounded-[9px] text-[13px] disabled:cursor-not-allowed disabled:text-faint ${!active ? "bg-raise font-medium shadow-[0_1px_2px_rgba(0,0,0,0.10)]" : "text-muted"}`}
              >
                {c.inactive}
              </button>
            </div>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function ClientSheet({ value, locale, onClose, onSaved }: {
  value: Client | "new" | null;
  locale: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const c = copyFor(locale);
  const existing = value && value !== "new" ? value : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!value || busy || !name.trim()) return;
    setBusy(true);
    try {
      if (value === "new") {
        await api("/api/clients", { method: "POST", body: { name } });
        toast(c.clientCreated);
      } else {
        await api(`/api/clients/${value.id}`, { method: "PATCH", body: { name, active } });
        toast(c.clientUpdated);
      }
      await onSaved();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save client.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={value !== null}
      onClose={onClose}
      title={value === "new" ? c.newClient : existing?.name ?? c.clients}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose} disabled={busy}>{c.cancel}</Button>
          <Button variant="primary" full onClick={() => void save()} disabled={busy || !name.trim()}>{value === "new" ? c.create : c.save}</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={c.name}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        {value !== "new" && (
          <Field label={c.accountStatus}>
            <div className="flex rounded-xl bg-fill p-[3px]">
              <button type="button" onClick={() => setActive(true)} className={`h-9 flex-1 rounded-[9px] text-[13px] ${active ? "bg-raise font-medium shadow-[0_1px_2px_rgba(0,0,0,0.10)]" : "text-muted"}`}>{c.active}</button>
              <button type="button" onClick={() => setActive(false)} className={`h-9 flex-1 rounded-[9px] text-[13px] ${!active ? "bg-raise font-medium shadow-[0_1px_2px_rgba(0,0,0,0.10)]" : "text-muted"}`}>{c.inactive}</button>
            </div>
          </Field>
        )}
      </div>
    </Sheet>
  );
}
