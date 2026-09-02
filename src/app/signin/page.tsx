"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronRight } from "@/components/icons";
import { useI18n, useSession } from "@/components/providers";
import { Button, Field, Input } from "@/components/ui";
import { homeFor } from "@/lib/auth/roles";
import { isAcceptablePassword, PASSWORD_POLICY_TEXT } from "@/lib/auth/password";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

function requestedPath(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("next");
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export default function SignInPage() {
  const { t } = useI18n();
  const { user, users, ready, auth, access, signIn, signOut } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(requestedPath() ?? homeFor(user.role));
  }, [ready, router, user]);

  if (!ready) return <div className="min-h-dvh bg-bg" />;
  if (user) return <div className="min-h-dvh bg-bg" />;

  if (auth === "supabase") {
    if (access === "denied") return <AccessDenied onSignOut={signOut} />;
    return <SupabaseAuth busy={busy} setBusy={setBusy} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">Billing</h1>
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
                .then(() => router.replace(requestedPath() ?? homeFor(candidate.role)))
                .finally(() => setBusy(false));
            }}
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-fill disabled:opacity-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-[13px] font-semibold text-muted">
              {candidate.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{candidate.name}</span>
              <span className="mt-0.5 block text-[12.5px] text-faint">{t(`role.${candidate.role}`)}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-[12px] leading-relaxed text-faint">{t("signin.dev")}</p>
    </div>
  );
}

type AuthMode = "signin" | "signup" | "reset";

function SupabaseAuth({ busy, setBusy }: { busy: boolean; setBusy: (busy: boolean) => void }) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const client = supabaseBrowserClient();

  const clearFeedback = () => {
    setError(null);
    setMessage(null);
  };

  const changeMode = (next: AuthMode) => {
    clearFeedback();
    setPassword("");
    setConfirmPassword("");
    setMode(next);
  };

  const signInWithEmail = async () => {
    if (busy || !client) return;
    setBusy(true);
    clearFeedback();
    const result = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (result.error) {
      setBusy(false);
      setError("Email or password is incorrect.");
      return;
    }
    window.location.assign(requestedPath() ?? "/");
  };

  const createAccount = async () => {
    if (busy || !client) return;
    clearFeedback();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Enter your name.");
      return;
    }
    if (!isAcceptablePassword(password)) {
      setError(PASSWORD_POLICY_TEXT);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    const result = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { name: cleanName } },
    });
    setBusy(false);

    if (result.error) {
      setError(
        /already|registered|exists/i.test(result.error.message)
          ? "This email is already registered. Sign in or reset your password."
          : "Could not create the account. Please try again.",
      );
      return;
    }

    if (result.data.session) await client.auth.signOut();
    setMessage("Account created. An Admin must approve your access before you can enter CIJD.");
  };

  const sendPasswordReset = async () => {
    if (busy || !client || !email.trim()) return;
    setBusy(true);
    clearFeedback();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
    const result = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    setBusy(false);
    if (result.error) {
      setError("Could not send the password setup email. Please try again.");
      return;
    }
    setMessage("Check your email and open the password setup link.");
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">Billing</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          {mode === "signin"
            ? "Sign in with your registered email"
            : mode === "signup"
              ? "Create your account. Admin approval is required."
              : "Set or reset your password by email."}
        </p>
      </div>

      {(error || message || !client) && (
        <p
          className={`mb-4 rounded-xl px-3 py-2 text-[13px] ${error || !client ? "bg-review/8 text-review" : "bg-paid/8 text-paid"}`}
          role="status"
        >
          {error ?? message ?? "Supabase setup is required."}
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 rounded-2xl bg-fill p-1.5">
        <button
          type="button"
          onClick={() => changeMode("signin")}
          className={`min-h-10 rounded-xl px-3 text-[13px] font-medium transition-colors ${mode !== "signup" ? "bg-panel text-text shadow-sm" : "text-muted"}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => changeMode("signup")}
          className={`min-h-10 rounded-xl px-3 text-[13px] font-medium transition-colors ${mode === "signup" ? "bg-panel text-text shadow-sm" : "text-muted"}`}
        >
          Sign up
        </button>
      </div>

      {mode === "signup" ? (
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              placeholder="Your name"
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") void createAccount();
              }}
            />
          </Field>
          <p className="text-[11.5px] leading-relaxed text-faint">{PASSWORD_POLICY_TEXT}</p>
          <Button
            type="button"
            variant="primary"
            full
            onClick={() => void createAccount()}
            disabled={busy || !client || !name.trim() || !email.trim() || !password || !confirmPassword}
          >
            Create account
          </Button>
        </div>
      ) : mode === "reset" ? (
        <div className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
              onKeyDown={(event) => {
                if (event.key === "Enter") void sendPasswordReset();
              }}
            />
          </Field>
          <Button
            type="button"
            variant="primary"
            full
            onClick={() => void sendPasswordReset()}
            disabled={busy || !client || !email.trim()}
          >
            Send password setup email
          </Button>
          <button
            type="button"
            className="w-full text-center text-[12.5px] text-muted underline-offset-4 hover:text-text hover:underline"
            onClick={() => changeMode("signin")}
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") void signInWithEmail();
              }}
            />
          </Field>
          <Button
            type="button"
            variant="primary"
            full
            onClick={() => void signInWithEmail()}
            disabled={busy || !client || !email.trim() || password.length < 1}
          >
            Sign in
          </Button>
          <button
            type="button"
            className="w-full text-center text-[12.5px] text-muted underline-offset-4 hover:text-text hover:underline"
            onClick={() => changeMode("reset")}
          >
            Set / forgot password
          </button>
        </div>
      )}
    </div>
  );
}

function AccessDenied({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</p>
      <p className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">Billing</p>
      <p className="mt-3 text-[16px] font-medium text-text">{t("signin.accessDenied")}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">Your account exists, but an Admin must approve access or assign the correct role.</p>
      <button
        type="button"
        className="mt-6 self-start text-[13px] text-muted underline-offset-4 hover:text-text hover:underline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onSignOut().finally(() => setBusy(false));
        }}
      >
        {t("signin.signOut")}
      </button>
    </div>
  );
}
