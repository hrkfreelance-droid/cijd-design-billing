"use client";

import { useI18n } from "@/components/providers";
import { Input, Select } from "@/components/ui";
import { isCostPriced, serviceByKey, serviceLabel, serviceOptions } from "@/lib/billing-v2/services";
import { money, moneyExact } from "@/lib/format";
import {
  draftFinal,
  draftRecommended,
  draftService,
  type ItemDraft,
} from "./item-draft";
import type { ServiceKey } from "@/lib/billing-v2/services";
import type { ServiceType } from "@/lib/types";

/**
 * One line item, open for editing.
 *
 * The fields a service actually has come from the registry: only a cost-priced
 * service shows Cost and its recommendation, so adding a service never means
 * adding a branch here.
 */
export function ItemEditor({
  draft,
  onChange,
  onRemove,
  index,
  serviceTypes = [],
}: {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  onRemove: () => void;
  index: number;
  serviceTypes?: ServiceType[];
}) {
  const { t } = useI18n();
  const service = draftService(draft, serviceTypes);
  const costPriced = isCostPriced(service);
  const recommended = draftRecommended(draft, serviceTypes);
  const final = draftFinal(draft);
  const overridden =
    costPriced && draft.priceTouched && recommended != null && final != null && final !== recommended;

  const patch = (changes: Partial<ItemDraft>) => onChange({ ...draft, ...changes });

  /** Entering a cost proposes a price; a price the person typed is left alone. */
  const setCost = (value: string) => {
    const next: ItemDraft = { ...draft, cost: value };
    const suggestion = draftRecommended(next, serviceTypes);
    if (!draft.priceTouched && suggestion != null) next.finalPrice = String(suggestion);
    onChange(next);
  };

  const setService = (key: ServiceKey) => {
    const next: ItemDraft = { ...draft, serviceKey: key };
    if (!isCostPriced(serviceByKey(key) ?? draftService({ ...next, serviceKey: key }, serviceTypes))) next.cost = "";
    onChange(next);
  };

  const available = serviceOptions(serviceTypes);
  const options = available.some((entry) => entry.key === service.key)
    ? available
    : [service, ...available];

  return (
    <div className="border-b border-line py-4 last:border-b-0" data-testid="v2-item">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Select
            aria-label={t("v2.service")}
            value={service.key}
            onChange={(event) => setService(event.target.value as ServiceKey)}
            data-testid={`v2-item-service-${index}`}
          >
            {options.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {serviceLabel(entry, t)}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-full px-2.5 py-1.5 text-[12.5px] text-faint transition-colors hover:bg-fill hover:text-review"
          data-testid={`v2-item-remove-${index}`}
        >
          {t("v2.removeItem")}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px] gap-3">
        <LabelledField label={t("v2.description")}>
          <Input
            value={draft.description}
            placeholder={t("v2.descriptionPlaceholder")}
            onChange={(event) => patch({ description: event.target.value })}
            data-testid={`v2-item-description-${index}`}
          />
        </LabelledField>
        <LabelledField label={t("v2.quantity")}>
          <Input
            inputMode="numeric"
            value={draft.quantity}
            onChange={(event) => patch({ quantity: event.target.value })}
            className="tnum"
            data-testid={`v2-item-quantity-${index}`}
          />
        </LabelledField>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {costPriced && (
          <>
            <LabelledField label={t("v2.cost")}>
              <Input
                inputMode="decimal"
                value={draft.cost}
                onChange={(event) => setCost(event.target.value)}
                className="tnum"
                data-testid={`v2-item-cost-${index}`}
              />
            </LabelledField>
            <div className="min-w-0">
              <span className="mb-1.5 block text-[12.5px] font-medium text-muted">
                {t("v2.recommended")}
              </span>
              <p
                className="tnum flex h-11 items-center text-[15px] text-muted"
                data-testid={`v2-item-recommended-${index}`}
              >
                {recommended == null ? "—" : moneyExact(recommended)}
              </p>
            </div>
          </>
        )}
        <LabelledField label={t("v2.finalPrice")}>
          <Input
            inputMode="decimal"
            value={draft.finalPrice}
            onChange={(event) => patch({ finalPrice: event.target.value, priceTouched: true })}
            className="tnum"
            data-testid={`v2-item-final-${index}`}
          />
        </LabelledField>
      </div>

      {overridden && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[12px] text-muted">
            {t("v2.manual")} · {t("v2.recommended")} {money(recommended)}
          </span>
          <button
            type="button"
            onClick={() => patch({ finalPrice: String(recommended) })}
            className="text-[12px] font-medium text-accent transition-colors hover:underline"
            data-testid={`v2-item-reset-${index}`}
          >
            {t("v2.resetToRecommended")}
          </button>
        </div>
      )}
    </div>
  );
}

function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
