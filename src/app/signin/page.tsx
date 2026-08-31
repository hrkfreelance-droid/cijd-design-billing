"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronRight } from "@/components/icons";
import { api, useI18n, useSession } from "@/components/providers";
import { Button, Field, Input } from "@/components/ui";
import { homeFor } from "@/lib/auth/roles";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function SignInPage() {
  const { t } = useI18n();
  const { user, users, ready, auth, signIn } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const recoveryUrl =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("reset") === "1";
  const inRecovery = recovery || recoveryUrl;

  useEffect(() => {
    if (auth !== "supabase") return;
    const client = supabaseBrowserClient();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [auth]);

  useEffect(() => {
    if (ready && user && !inRecovery) router.replace(homeFor(user.role));
  }, [inRecovery, ready, user, router]);

  const cancelRecovery = () => {
    setRecovery(false);
    if (recoveryUrl) router.replace("/signin");
  };

  if (!ready) {
    return <div className="min-h-dvh bg-bg" />;
  }

  // Supabase configured: real credentials. Otherwise the development picker.
  if (auth === "supabase") {
    return <SupabaseSignIn recovery={inRecovery} onCancelRecovery={cancelRecovery} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
          {t("brand.company")}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">
          {t("signin.title")}
        </h1>
        <p className="mt-2 text-[13.5px] text-muted">{t("signin.hint")}</p>
      </div>

      <div className="divide-y divide-line rounded-2xl border border-line bg-panel">
        {users.map((candidate) => (
          <button
            key={candidate.id}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signIn(candidate.id)
                .then(() => router.replace(homeFor(candidate.role)))
                .finally(() => setBusy(false));
            }}
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-fill disabled:opacity-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-[13px] font-semibold text-muted">
              {candidate.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{candidate.name}</span>
              <span className="mt-0.5 block text-[12.5px] text-faint">
                {t(`role.${candidate.role}`)}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-[12px] leading-relaxed text-faint">
        {t("signin.dev")}
      </p>
    </div>
  );
}

function SupabaseSignIn({
  recovery,
  onCancelRecovery,
}: {
  recovery: boolean;
  onCancelRecovery: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const client = supabaseBrowserClient();
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    const { error: failure } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (failure) {
      setError(t("signin.invalid"));
      return;
    }
    try {
      const who = await api<{ user: { role: "DESIGNER" | "BILLING" | "ACCOUNTING" | "PRINTING" | "ADMIN" } | null }>(
        "/api/session",
      );
      if (!who.user) {
        await client.auth.signOut();
        setError(t("signin.inactive"));
        return;
      }
      router.refresh();
      router.replace(homeFor(who.user.role));
    } catch {
      await client.auth.signOut().catch(() => null);
      setError(t("signin.unavailable"));
    }
  };

  const requestReset = async () => {
    const client = supabaseBrowserClient();
    if (!client || busy) return;
    if (!email.trim()) {
      setError(t("signin.emailRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: failure } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/signin?reset=1`,
    });
    setBusy(false);
    if (failure) {
      setError(t("signin.unavailable"));
      return;
    }
    setNotice(t("signin.resetSent"));
  };

  const updatePassword = async () => {
    const client = supabaseBrowserClient();
    if (!client || busy) return;
    if (newPassword.length < 8) {
      setError(t("signin.resetShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("signin.resetMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: failure } = await client.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (failure) {
      setError(t("signin.unavailable"));
      return;
    }
    setNotice(t("signin.passwordUpdated"));
    setNewPassword("");
    setConfirmPassword("");
    onCancelRecovery();
    router.refresh();
    router.replace("/");
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
          {t("brand.company")}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">
          {recovery ? t("signin.updatePassword") : t("signin.title")}
        </h1>
        <p className="mt-2 text-[13.5px] text-muted">
          {recovery ? t("signin.resetHint") : t("signin.hint")}
        </p>
      </div>
      {recovery ? (
        <div className="space-y-4">
          <Field label={t("signin.newPassword")}>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label={t("signin.confirmPassword")}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void updatePassword();
              }}
            />
          </Field>
          {error && <p className="text-[13px] text-review" role="alert">{error}</p>}
          {notice && <p className="text-[13px] text-muted" role="status">{notice}</p>}
          <Button variant="primary" full onClick={updatePassword} disabled={busy}>
            {t("signin.updatePassword")}
          </Button>
          <Button variant="secondary" full onClick={onCancelRecovery} disabled={busy}>
            {t("signin.back")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t("signin.email")}>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={t("signin.password")}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </Field>
          {error && <p className="text-[13px] text-review" role="alert">{error}</p>}
          {notice && <p className="text-[13px] text-muted" role="status">{notice}</p>}
          <Button
            variant="primary"
            full
            onClick={submit}
            disabled={!email || !password || busy}
          >
            {t("signin.title")}
          </Button>
          <button
            type="button"
            onClick={requestReset}
            disabled={busy}
            className="w-full py-2 text-[13px] text-muted transition-colors hover:text-text disabled:opacity-50"
          >
            {t("signin.reset")}
          </button>
        </div>
      )}
    </div>
  );
}
