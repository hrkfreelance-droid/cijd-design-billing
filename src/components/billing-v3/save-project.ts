"use client";

import { api } from "@/components/providers";
import { storedFinalUnitPrice } from "@/lib/billing-v2/board";
import { printSellingPriceFromCost, roundCents } from "@/lib/billing-v2/pricing";
import { isCostPriced } from "@/lib/billing-v2/services";
import type { BillingItem, Project, ServiceType } from "@/lib/types";
import {
  draftChanged,
  draftTotalCost,
  draftFinal,
  draftFinalUnit,
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
 *
 * Lines are written one at a time and each finished line is reported back, so
 * if the connection drops half way a retry picks up where it stopped instead
 * of creating a line twice.
 */
export interface ProjectSaveInput {
  projectId: string;
  name: string;
  note: string;
  originalName: string;
  originalNote: string;
  drafts: ItemDraft[];
  serviceTypes?: ServiceType[];
  /** The deposit to store; undefined leaves it untouched. */
  deposit?: number | null;
  originalDeposit?: number | null;
  /**
   * The project was ready to bill when editing began. Editing it keeps it
   * there, as long as every line still has a price.
   */
  keepReady: boolean;
  onLineSaved?: (key: string, item: BillingItem | null) => void;
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
      if (draft.id) {
        await api(`/api/billing-items/${draft.id}`, { method: "DELETE" });
        input.onLineSaved?.(draft.key, null);
      }
      continue;
    }
    if (!draft.id) {
      input.onLineSaved?.(draft.key, await createItem(input.projectId, draft, input.serviceTypes));
    } else if (draftChanged(draft)) {
      await updateItem(draft, input.serviceTypes);
    }
  }

  if (input.deposit !== undefined && (input.deposit ?? null) !== (input.originalDeposit ?? null)) {
    await api<Project>(`/api/projects/${input.projectId}/deposit`, {
      method: "PATCH",
      body: { amount: input.deposit },
    });
  }

  const live = input.drafts.filter((draft) => !draft.removed);
  if (input.keepReady && live.length > 0 && live.every((draft) => draftFinal(draft) !== null)) {
    await api(`/api/projects/${input.projectId}/readiness`, {
      method: "PATCH",
      body: { readiness: "READY" },
    });
  }
}

async function createItem(
  projectId: string,
  draft: ItemDraft,
  serviceTypes: ServiceType[] = [],
): Promise<BillingItem> {
  const service = draftService(draft, serviceTypes);
  const cost = draftTotalCost(draft, serviceTypes);
  const final = draftFinal(draft);

  // A cost-priced line left at its default recommendation is saved without an
  // explicit price, so a later cost change is still free to move it.
  const followsRecommendation =
    isCostPriced(service) &&
    draft.finalMode === "AUTO" &&
    cost != null &&
    final === printSellingPriceFromCost(cost);

  const created = await api<BillingItem>("/api/billing-items", {
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

  // The ledger prices a costed line from its cost on the way in; an emptied
  // price field means "pending", so say so explicitly.
  if (final === null && created.amount !== null) {
    return api<BillingItem>(`/api/billing-items/${created.id}`, { method: "PATCH", body: { amount: null } });
  }
  // Whatever the ledger settled on, the number on screen is the one saved.
  return (await writeFinal(created, draft)) ?? created;
}

/**
 * Writes the final price when the stored one differs from the draft: the
 * total, and for a manual price the unit price that goes with it.
 */
async function writeFinal(stored: BillingItem, draft: ItemDraft): Promise<BillingItem | null> {
  const final = draftFinal(draft);
  if (final === null) return null;
  const unit = draftFinalUnit(draft);
  const manual = draft.finalMode !== "AUTO";
  const amountDiffers = stored.amount === null || roundCents(stored.amount) !== final;
  const unitDiffers = manual && unit !== null && storedFinalUnitPrice(stored) !== unit;
  if (!amountDiffers && !unitDiffers) return null;
  return api<BillingItem>(`/api/billing-items/${stored.id}/billing-price`, {
    method: "PATCH",
    body: unit === null ? { amount: final } : { amount: final, unitPrice: unit },
  });
}

async function updateItem(draft: ItemDraft, serviceTypes: ServiceType[] = []): Promise<void> {
  const id = draft.id as string;
  const service = draftService(draft, serviceTypes);
  const before = draft.original;
  const costPriced = isCostPriced(service);
  const quantity = parseAmount(draft.quantity) ?? 1;
  const description = draft.description.trim();
  const cost = draftTotalCost(draft, serviceTypes);
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

  if (costPriced && (serviceChanged || detailsChanged || before?.item.printCost !== cost)) {
    latest = await api<BillingItem>(`/api/printing-items/${id}/spec`, {
      method: "PATCH",
      body: { description, quantity, printCost: cost ?? undefined },
    });
  }

  // The price goes last, once everything else has settled, so the number the
  // person typed is the number that survives.
  if (final === null) {
    const settled = latest ? latest.amount : (before?.amount ?? null);
    if (settled !== null) await api(`/api/billing-items/${id}`, { method: "PATCH", body: { amount: null } });
    return;
  }
  const stored = latest ?? before?.item ?? null;
  if (stored) await writeFinal(stored, draft);
}
