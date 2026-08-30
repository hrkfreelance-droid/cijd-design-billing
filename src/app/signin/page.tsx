"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronRight } from "@/components/icons";
import { useI18n, useSession } from "@/components/providers";
import { Button, Field, Input } from "@/components/ui";
import { homeFor } from "@/lib/auth/roles";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function SignInPage() {
  const { t } = useI18n();
  const { user, users, ready, auth, signIn } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(homeFor(user.role));
  }, [ready, user, router]);

  if (!ready) return <div className="min-h-dvh bg-bg" />;

  // Supabase configured: real credentials. Otherwise the development picker.
  if (auth === "supabase") return <SupabaseSignIn />;

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

function SupabaseSignIn() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const client = supabaseBrowserClient();
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    const { error: failure } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (failure) {
      setError(failure.message);
      return;
    }
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
          {t("signin.title")}
        </h1>
      </div>
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
        {error && <p className="text-[13px] text-review">{error}</p>}
        <Button
          variant="primary"
          full
          onClick={submit}
          disabled={!email || !password || busy}
        >
          {t("signin.title")}
        </Button>
      </div>
    </div>
  );
}
