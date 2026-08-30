import { initialSnapshot } from "./initial-data";
import { BillingSnapshot } from "./types";

export interface BillingRepository {
  load(): BillingSnapshot;
  save(snapshot: BillingSnapshot): void;
}

const STORAGE_KEY = "cijd-design-billing.snapshot.v1";

const clone = (value: BillingSnapshot): BillingSnapshot => JSON.parse(JSON.stringify(value)) as BillingSnapshot;

export function createLocalRepository(): BillingRepository {
  return {
    load() {
      if (typeof window === "undefined") return clone(initialSnapshot);
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored ? (JSON.parse(stored) as BillingSnapshot) : clone(initialSnapshot);
      } catch {
        return clone(initialSnapshot);
      }
    },
    save(snapshot) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    },
  };
}

export const repositoryStorageKey = STORAGE_KEY;
