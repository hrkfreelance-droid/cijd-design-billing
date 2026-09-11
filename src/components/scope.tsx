"use client";

import { useMemo } from "react";

import { useClientFilter, useData } from "@/components/providers";
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

/** Everything on screen respects the client chip at the top of the app. */
export function useScope(): Scope | null {
  const { snapshot } = useData();
  const { clientId } = useClientFilter();

  return useMemo(() => {
    if (!snapshot) return null;
    const idx = index(snapshot);
    const projects = clientId
      ? snapshot.projects.filter((p) => p.clientId === clientId)
      : snapshot.projects;
    const projectIds = new Set(projects.map((p) => p.id));
    const items = clientId
      ? snapshot.billingItems.filter((i) => projectIds.has(i.projectId))
      : snapshot.billingItems;
    const invoices = clientId
      ? snapshot.invoices.filter((i) => i.clientId === clientId)
      : snapshot.invoices;
    return {
      snapshot,
      idx,
      clientId,
      client: clientId ? (idx.clientById.get(clientId) ?? null) : null,
      projects,
      items,
      invoices,
      clientOf: (projectId: string) => {
        const project = idx.projectById.get(projectId);
        return project ? idx.clientById.get(project.clientId) : undefined;
      },
    };
  }, [snapshot, clientId]);
}

/** Deliberately quiet: a couple of grey bars, no shimmer. */
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
