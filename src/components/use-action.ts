"use client";

import { useCallback, useState } from "react";

import { useData, useI18n, useToast } from "@/components/providers";
import { ApiError } from "@/lib/api-error";
import { dictionaries, type MessageKey } from "@/lib/i18n";

/**
 * Runs a mutation, refreshes the snapshot, shows a quiet toast on success and a
 * readable message on failure. Server error codes are translated where we have
 * a phrasing for them; anything else falls back to the server's own sentence.
 */
export function useAction() {
  const { refresh } = useData();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);

  const describe = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        if (error.code === "OFFLINE") return t("error.offline");
        const key = `error.${error.code}` as MessageKey;
        if (key in dictionaries[locale]) return t(key);
        return error.message || t("error.generic");
      }
      return t("error.generic");
    },
    [locale, t],
  );

  const run = useCallback(
    async (
      fn: () => Promise<unknown>,
      success?: { key: MessageKey; vars?: Record<string, string | number> },
    ): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      try {
        await fn();
        await refresh();
        if (success) toast(t(success.key, success.vars));
        return true;
      } catch (error) {
        toast(describe(error), "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, describe, refresh, t, toast],
  );

  return { busy, run, describe };
}
