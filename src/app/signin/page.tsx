"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronRight } from "@/components/icons";
import { useI18n, useSession } from "@/components/providers";
import { Button } from "@/components/ui";
import { homeFor } from "@/lib/auth/roles";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function SignInPage() {
  const { t } = useI18n();
  const { user, users, ready, auth, access, signIn, signOut } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(homeFor(user.role));
  }, [ready, router, user]);

  if (!ready) return <div className="min-h-dvh bg-bg" />;
  if (user) return <div className="min-h-dvh bg-bg" />;

  if (auth === "supabase") {
    if (access === "denied") return <AccessDenied onSignOut={signOut} />;
    return <GoogleSignIn busy={busy} setBusy={setBusy} />;
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

function GoogleSignIn({
  busy,
  setBusy,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const client = supabaseBrowserClient();

  const continueWithGoogle = async () => {
    if (busy) return;
    if (!client) {
      setError(t("signin.setupRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/")}`;
    const { error: failure } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (failure) {
      setBusy(false);
      setError(t("signin.unavailable"));
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">Billing</h1>
        <p className="mt-2 text-[13.5px] text-muted">{t("signin.required")}</p>
      </div>
      {(error || !client) && (
        <p className="mb-4 text-[13px] text-review" role="alert">
          {error ?? t("signin.setupRequired")}
        </p>
      )}
      <Button
        type="button"
        variant="primary"
        full
        onClick={() => void continueWithGoogle()}
        disabled={busy || !client}
        data-testid="google-sign-in"
      >
        {t("signin.google")}
      </Button>
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
