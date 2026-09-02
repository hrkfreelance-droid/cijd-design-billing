"use client";

import { useState } from "react";

import { Button, Field, Input } from "@/components/ui";
import { isAcceptablePassword, PASSWORD_POLICY_TEXT } from "@/lib/auth/password";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const client = supabaseBrowserClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!client || busy) return;
    setError(null);
    if (!isAcceptablePassword(password)) {
      setError(PASSWORD_POLICY_TEXT);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    const result = await client.auth.updateUser({ password });
    if (result.error) {
      setBusy(false);
      setError("Could not update your password. Open the latest password setup email and try again.");
      return;
    }

    await client.auth.signOut();
    window.location.assign("/signin");
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">CIJD</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.021em]">Set password</h1>
        <p className="mt-2 text-[13.5px] text-muted">Choose the password you will use to sign in.</p>
      </div>

      {(error || !client) && (
        <p className="mb-4 rounded-xl bg-review/8 px-3 py-2 text-[13px] text-review" role="alert">
          {error ?? "Supabase setup is required."}
        </p>
      )}

      <div className="space-y-4">
        <Field label="New password">
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
              if (event.key === "Enter") void save();
            }}
          />
        </Field>
        <p className="text-[11.5px] leading-relaxed text-faint">{PASSWORD_POLICY_TEXT}</p>
        <Button
          type="button"
          variant="primary"
          full
          onClick={() => void save()}
          disabled={busy || !client || !password || !confirmPassword}
        >
          Save password
        </Button>
      </div>
    </div>
  );
}
