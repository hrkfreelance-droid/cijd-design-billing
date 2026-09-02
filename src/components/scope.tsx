"use client";

import { useMemo } from "react";

import { useData } from "@/components/providers";
import { index, type Indexed } from "@/lib/derive";
import type { BillingItem, Client, Invoice, Project, Snapshot } from "@/lib/types";

export interface Scope {
  snapshot: Snapshot;
  idx: Indexed;
  clientId: string | null;
  client: Client | null;
  projects: Project[];
  items: BillingItem[];
  invoices: Invoice[];
  clientOf: (projectId: string) => Client | undefined;
}

/**
 * Client chips were removed from the global header. Screens now work from the
 * full dataset and group or label clients where that context is useful.
 */
export function useScope(): Scope | null {
  const { snapshot } = useData();

  return useMemo(() => {
    if (!snapshot) return null;
    const idx = index(snapshot);
    return {
      snapshot,
      idx,
      clientId: null,
      client: null,
      projects: snapshot.projects,
      items: snapshot.billingItems,
      invoices: snapshot.invoices,
      clientOf: (projectId: string) => {
        const project = idx.projectById.get(projectId);
        return project ? idx.clientById.get(project.clientId) : undefined;
      },
    };
  }, [snapshot]);
}

export function PageSkeleton() {
  return (
    <div className="animate-fade px-5 pt-9 sm:px-8">
      <div className="h-8 w-40 rounded-lg bg-fill" />
      <div className="mt-3 h-4 w-56 rounded bg-fill" />
      <div className="mt-10 space-y-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-14 rounded-xl bg-fill" />
        ))}
      </div>
    </div>
  );
}
