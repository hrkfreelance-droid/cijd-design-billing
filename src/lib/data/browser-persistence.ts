"use client";

import type { Database } from "@/lib/types";
import type { Persistence } from "./store";
import { buildDemoSeed } from "./demo-seed";

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
      return raw ? (JSON.parse(raw) as Database) : buildDemoSeed();
    } catch {
      return null;
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
