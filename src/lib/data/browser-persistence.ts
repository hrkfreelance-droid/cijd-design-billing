"use client";

import type { Database } from "@/lib/types";
import type { Persistence } from "./store";
import { buildDemoSeed, removePreviewOnlyRecords } from "./demo-seed";
import { mergeRingerHutHistory } from "./ringer-hut-history";

const KEY = "cijd.demo.db";

/**
 * Demo mode keeps the whole store in the visitor's own browser, so the public
 * preview is fully interactive without a database — and nobody sees anyone
 * else's edits. `?reset` restores the sample data.
 */
export const browserPersistence: Persistence = {
  async read() {
    try {
      const raw = localStorage.getItem(KEY);
      const db = raw
        ? removePreviewOnlyRecords(JSON.parse(raw) as Database)
        : buildDemoSeed();
      const merged = mergeRingerHutHistory(db, new Date().toISOString());
      try {
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {
        // Keep the merged in-memory state even when storage is read-only/full.
      }
      return merged;
    } catch {
      return buildDemoSeed();
    }
  },
  async write(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      // Private browsing or a full quota: the session stays in memory.
    }
  },
};

export function clearDemoData() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
