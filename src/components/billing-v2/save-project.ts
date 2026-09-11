"use client";

import { api } from "@/components/providers";
import { printSellingPriceFromCost } from "@/lib/billing-v2/pricing";
import { isCostPriced } from "@/lib/billing-v2/services";
import type { BillingItem, ServiceType } from "@/lib/types";
import {
  draftCost,
  draftFinal,
  draftService,
  parseAmount,
  type ItemDraft,
} from "./item-draft";

/**
 * Writes what the modal changed, and only that.
 *
 * Each line takes the narrowest route that can carry its change: the print
 * spec endpoint owns cost, the billing-price endpoint owns the final price,
 * and the general item endpoint owns the rest. Keeping them apart is what lets
 * the database go on knowing which prices a person chose for themselves.
 */
export interface ProjectSaveInput {
  projectId: string;
  name: string;
  note: string;
  originalName: string;
  originalNote: string;
  drafts: ItemDraft[];
  serviceTypes?: ServiceType[];
}

export async function saveProject(input: ProjectSaveInput): Promise<void> {
  if (input.name.trim() !== input.originalName || input.note.trim() !== input.originalNote) {
    await api(`/api/projects/${input.projectId}`, {
      method: "PATCH",
      body: { name: input.name.trim(), note: input.note.trim() },
    });
  }

  for (const draft of input.drafts) {
    if (draft.removed) {
      if (draft.id) await api(`/api/billing-items/${draft.id}`, { method: "DELETE" });
      continue;
    }
    if (draft.id) await updateItem(draft, input.serviceTypes);
    else await createItem(input.projectId, draft, input.serviceTypes);
  }
}

async function createItem(projectId: string, draft: ItemDraft, serviceTypes: ServiceType[] = []): Promise<void> {
  const service = draftService(draft, serviceTypes);
  const cost = draftCost(draft, serviceTypes);
  const final = draftFinal(draft);

  // A cost-priced line left at its recommendation is saved without an explicit
  // price, so a later cost change is still free to move it.
  const followsRecommendation =
    isCostPriced(service) && cost != null && final === printSellingPriceFromCost(cost);

  await api("/api/billing-items", {
    method: "POST",
    body: {
      projectId,
      description: draft.description.trim(),
      type: service.storageType,
      serviceType: service.key,
      quantity: parseAmount(draft.quantity) ?? 1,
      printCost: cost ?? undefined,
      amount: followsRecommendation ? undefined : (final ?? undefined),
    },
  });
}

async function updateItem(draft: ItemDraft, serviceTypes: ServiceType[] = []): Promise<void> {
  const id = draft.id as string;
  const service = draftService(draft, serviceTypes);
  const before = draft.original;
  const costPriced = isCostPriced(service);
  const quantity = parseAmount(draft.quantity) ?? 1;
  const description = draft.description.trim();
  const cost = draftCost(draft, serviceTypes);
  const final = draftFinal(draft);

  const serviceChanged = !before || before.service.key !== service.key;
  const detailsChanged =
    !before || before.item.description !== description || before.item.quantity !== quantity;

  let latest: BillingItem | null = null;

  if (serviceChanged || (detailsChanged && !costPriced)) {
    latest = await api<BillingItem>(`/api/billing-items/${id}`, {
      method: "PATCH",
      body: {
        ...(serviceChanged ? { type: service.storageType, serviceType: service.key } : {}),
        ...(detailsChanged && !costPriced ? { description, quantity } : {}),
      },
    });
  }

  if (costPriced && (detailsChanged || !before || before.item.printCost !== cost)) {
    latest = await api<BillingItem>(`/api/printing-items/${id}/spec`, {
      method: "PATCH",
      body: { description, quantity, printCost: cost ?? undefined },
    });
  }

  // The price goes last, once everything else has settled, so the number the
  // person typed is the number that survives.
  const settled = latest?.amount ?? before?.amount ?? null;
  if (final !== settled) {
    if (final === null) {
      await api(`/api/billing-items/${id}`, { method: "PATCH", body: { amount: null } });
    } else {
      await api(`/api/billing-items/${id}/billing-price`, {
        method: "PATCH",
        body: { amount: final },
      });
    }
  }
}
