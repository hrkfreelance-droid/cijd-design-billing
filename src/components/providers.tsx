"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ApiError } from "@/lib/api-error";
import type { SessionAccess, SessionUser } from "@/lib/auth/session";
import { demoRequest } from "@/lib/data/demo-client";
import { translate, type Locale, type MessageKey } from "@/lib/i18n";
import type { User } from "@/lib/types";
import * as prefs from "@/lib/prefs";
import type { Snapshot } from "@/lib/types";
import { hasSupabaseBrowserConfig, isBrowserDemoMode, isDemoMode } from "@/lib/runtime";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/* ------------------------------------------------------------------ api */

export { ApiError } from "@/lib/api-error";

export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method ?? "GET";
  // The public preview has no backend: the same repository runs in the browser.
  if (isBrowserDemoMode()) return demoRequest<T>(path, method, init?.body);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("OFFLINE", "OFFLINE");
  }
  const payload = (await response.json().catch(() => null)) as
    | { ok: boolean; data?: T; message?: string; code?: string }
    | null;
  if (!response.ok || !payload?.ok) {
    throw new ApiError(payload?.message ?? "Request failed", payload?.code ?? "ERROR");
  }
  return payload.data as T;
}

/* ------------------------------------------------------------- contexts */

const ThemeContext = createContext<{
  theme: prefs.Theme;
  setTheme: (theme: prefs.Theme) => void;
}>({ theme: "light", setTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}>({ locale: "ja", setLocale: () => {}, t: (key) => key });
export const useI18n = () => useContext(LocaleContext);

const ClientContext = createContext<{
  clientId: string | null;
  setClientId: (id: string | null) => void;
}>({ clientId: null, setClientId: () => {} });
export const useClientFilter = () => useContext(ClientContext);

const SessionContext = createContext<{
  user: SessionUser | null;
  users: User[];
  auth: "local" | "supabase";
  access: SessionAccess;
  ready: boolean;
  signIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
}>({
  user: null,
  users: [],
  auth: "local",
  access: "signed_out",
  ready: false,
  signIn: async () => {},
  signOut: async () => {},
});
export const useSession = () => useContext(SessionContext);

const DataContext = createContext<{
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>({ snapshot: null, loading: true, error: null, refresh: async () => {} });
export const useData = () => useContext(DataContext);

type Toast = { id: number; message: string; tone: "info" | "error" };
const ToastContext = createContext<{
  toast: (message: string, tone?: "info" | "error") => void;
}>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

/* ------------------------------------------------------------ provider */

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(
    prefs.subscribe,
    prefs.clientMounted,
    prefs.serverMounted,
  );
  const theme = useSyncExternalStore(prefs.subscribe, prefs.getTheme, prefs.serverTheme);
  const locale = useSyncExternalStore(prefs.subscribe, prefs.getLocale, prefs.serverLocale);
  const clientId = useSyncExternalStore(
    prefs.subscribe,
    prefs.getClientId,
    prefs.serverClientId,
  );

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [session, setSession] = useState<{
    user: SessionUser | null;
    users: User[];
    auth: "local" | "supabase";
    access: SessionAccess;
  }>({ user: null, users: [], auth: "local", access: "signed_out" });
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const signIn = useCallback(async (userId: string) => {
    const user = await api<SessionUser>("/api/session", { method: "POST", body: { userId } });
    const who = await api<{
      user: SessionUser | null;
      users: User[];
      auth: "local" | "supabase";
      access: SessionAccess;
    }>("/api/session");
    setSession({ user: who.user ?? user, users: who.users, auth: who.auth, access: who.access });
    const data = await api<Snapshot>("/api/state").catch(() => null);
    if (data) setSnapshot(data);
  }, []);

  const signOut = useCallback(async () => {
    // Supabase owns the session when it is configured.
    const { supabaseBrowserClient } = await import("@/lib/supabase/browser");
    const client = supabaseBrowserClient();
    if (client) await client.auth.signOut().catch(() => null);
    await api("/api/session", { method: "DELETE" }).catch(() => null);
    setSession((current) => ({ ...current, user: null, access: "signed_out" }));
    setSnapshot(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Snapshot>("/api/state");
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ERROR");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let live = true;
    void (async () => {
      const who = await api<{
        user: SessionUser | null;
        users: User[];
        auth: "local" | "supabase";
        access: SessionAccess;
      }>("/api/session").catch(() => ({
        user: null,
        users: [],
        // A production/Supabase outage must not fall back to the local user
        // picker. The picker is only valid when Supabase is not configured.
        auth: hasSupabaseBrowserConfig ? ("supabase" as const) : ("local" as const),
        access: "signed_out" as const,
      }));
      if (!live) return;
      setSession(who);
      setSessionReady(true);
      if (!who.user) {
        setLoading(false);
        return;
      }
      const data = await api<Snapshot>("/api/state").catch(() => null);
      if (!live) return;
      if (data) setSnapshot(data);
      else setError("OFFLINE");
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [mounted]);

  // Keep the UI aligned with Supabase Auth when a token expires, is refreshed,
  // or the user signs out in another tab. The server still re-reads the role
  // from public.users for every protected request.
  useEffect(() => {
    if (!mounted || isDemoMode || !hasSupabaseBrowserConfig) return;
    const client = supabaseBrowserClient();
    if (!client) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => {
      void api<{
        user: SessionUser | null;
        users: User[];
        auth: "local" | "supabase";
        access: SessionAccess;
      }>("/api/session")
        .then(async (who) => {
          if (!live) return;
          setSession(who);
          setSessionReady(true);
          if (!who.user) {
            setSnapshot(null);
            setLoading(false);
            return;
          }
          const data = await api<Snapshot>("/api/state").catch(() => null);
          if (!live) return;
          if (data) setSnapshot(data);
          else setError("OFFLINE");
          setLoading(false);
        })
        .catch(() => {
          if (!live) return;
          setSession((current) => ({
            ...current,
            user: null,
            auth: "supabase",
            access: "signed_out",
          }));
          setSnapshot(null);
          setError("OFFLINE");
          setLoading(false);
        });
    };

    const { data } = client.auth.onAuthStateChange((event) => {
      if (!live) return;
      if (event === "SIGNED_OUT") {
        setSession((current) => ({
          ...current,
          user: null,
          auth: "supabase",
          access: "signed_out",
        }));
        setSnapshot(null);
        setLoading(false);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        timer = setTimeout(sync, 0);
      }
    });

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, [mounted]);

  // A client that no longer exists silently falls back to All Clients.
  useEffect(() => {
    if (!snapshot || !clientId) return;
    if (!snapshot.clients.some((c) => c.id === clientId)) prefs.setClientId(null);
  }, [snapshot, clientId]);

  const toast = useCallback((message: string, tone: "info" | "error" = "info") => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      tone === "error" ? 5000 : 2600,
    );
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  const themeValue = useMemo(
    () => ({ theme, setTheme: prefs.setTheme }),
    [theme],
  );
  const localeValue = useMemo(
    () => ({ locale, setLocale: prefs.setLocale, t }),
    [locale, t],
  );
  const clientValue = useMemo(
    () => ({ clientId, setClientId: prefs.setClientId }),
    [clientId],
  );
  const dataValue = useMemo(
    () => ({ snapshot, loading, error, refresh }),
    [snapshot, loading, error, refresh],
  );
  const toastValue = useMemo(() => ({ toast }), [toast]);
  const sessionValue = useMemo(
    () => ({
      user: session.user,
      users: session.users,
      auth: session.auth,
      access: session.access,
      ready: sessionReady,
      signIn,
      signOut,
    }),
    [session, sessionReady, signIn, signOut],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <LocaleContext.Provider value={localeValue}>
        <ClientContext.Provider value={clientValue}>
          <SessionContext.Provider value={sessionValue}>
          <DataContext.Provider value={dataValue}>
            <ToastContext.Provider value={toastValue}>
              {mounted ? children : <div className="min-h-dvh bg-bg" />}
              <ToastStack toasts={toasts} />
            </ToastContext.Provider>
          </DataContext.Provider>
          </SessionContext.Provider>
        </ClientContext.Provider>
      </LocaleContext.Provider>
    </ThemeContext.Provider>
  );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="safe-bottom-toast pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className={`animate-rise max-w-full rounded-full border px-4 py-2 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur ${
            item.tone === "error"
              ? "border-review/40 bg-panel text-review"
              : "border-line bg-panel/95 text-text"
          }`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
