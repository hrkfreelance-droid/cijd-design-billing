"use client";

import { useState, type ReactNode } from "react";

import { useI18n } from "@/components/providers";
import { Button, Input, Select } from "@/components/ui";
import { isCostPriced, serviceLabel, serviceOptions, type ServiceKey } from "@/lib/billing-v2/services";
import { printMarginFromCost } from "@/lib/billing-v2/pricing";
import { moneyExact } from "@/lib/format";
import type { ServiceType } from "@/lib/types";
import {
  draftCost,
  draftErrors,
  draftFinal,
  draftRecommended,
  draftService,
  withCost,
  type ItemDraft,
} from "./item-draft";

const NEW_SERVICE = "__new__";

/** Desktop column rhythm shared by the header row and every line. */
export const EDIT_GRID =
  "sm:grid sm:grid-cols-[8.5rem_minmax(0,1fr)_4.25rem_6.5rem_7rem_2.25rem] sm:items-start sm:gap-x-3";

/** Column headings for the edit list; phones label each field instead. */
export function ItemEditorHeader({ showCost }: { showCost: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`hidden pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint ${EDIT_GRID}`}>
      <span>{t("v2.service")}</span>
      <span>{t("v2.description")}</span>
      <span>{t("v2.quantity")}</span>
      <span>{showCost ? t("v2.cost") : ""}</span>
      <span>{t("v2.finalPrice")}</span>
      <span />
    </div>
  );
}

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
  onRestore,
  onAddService,
  index,
  serviceTypes = [],
  disabled = false,
}: {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  onRemove: () => void;
  onRestore: () => void;
  /** Creates a service and resolves to its key, or null if it could not be added. */
  onAddService: (name: string) => Promise<string | null>;
  index: number;
  serviceTypes?: ServiceType[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [addingService, setAddingService] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [savingService, setSavingService] = useState(false);

  const service = draftService(draft, serviceTypes);
  const costPriced = isCostPriced(service);
  const recommended = draftRecommended(draft, serviceTypes);
  const cost = draftCost(draft, serviceTypes);
  const final = draftFinal(draft);
  const errors = draftErrors(draft);
  const overridden = costPriced && recommended != null && final != null && final !== recommended;

  if (draft.removed) {
    return (
      <div
        className="flex items-center justify-between gap-4 border-b border-line py-3 text-[13.5px]"
        data-testid="v2-item-removed"
      >
        <span className="min-w-0 truncate text-faint line-through">
          {serviceLabel(service, t)} · {draft.description || serviceLabel(service, t)}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-[12.5px] text-muted">{t("v2.itemRemoved")}</span>
          <button
            type="button"
            onClick={onRestore}
            className="text-[13px] font-medium text-accent hover:underline"
            data-testid={`v2-item-undo-${index}`}
          >
            {t("v2.undo")}
          </button>
        </span>
      </div>
    );
  }

  const patch = (changes: Partial<ItemDraft>) => onChange({ ...draft, ...changes });

  const setService = (key: string) => {
    if (key === NEW_SERVICE) {
      setAddingService(true);
      return;
    }
    const next: ItemDraft = { ...draft, serviceKey: key as ServiceKey };
    if (!isCostPriced(draftService(next, serviceTypes))) next.cost = "";
    onChange(next);
  };

  const addService = async () => {
    const name = serviceName.trim();
    if (!name) return;
    setSavingService(true);
    const key = await onAddService(name);
    setSavingService(false);
    if (key) {
      setAddingService(false);
      setServiceName("");
      onChange({ ...draft, serviceKey: key, cost: "" });
    }
  };

  const available = serviceOptions(serviceTypes);
  const options = available.some((entry) => entry.key === service.key) ? available : [service, ...available];

  return (
    <div className="border-b border-line py-3.5" data-testid="v2-item">
      <div className={`grid grid-cols-[minmax(0,1fr)_2.25rem] gap-x-2 gap-y-2.5 ${EDIT_GRID}`}>
        <Field label={t("v2.service")} className="sm:col-start-1">
          <Select
            aria-label={t("v2.service")}
            value={addingService ? NEW_SERVICE : service.key}
            onChange={(event) => setService(event.target.value)}
            disabled={disabled}
            data-testid={`v2-item-service-${index}`}
          >
            {options.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {serviceLabel(entry, t)}
              </option>
            ))}
            <option value={NEW_SERVICE}>{t("v2.newService")}</option>
          </Select>
        </Field>

        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2 sm:contents">
          <Field label={t("v2.description")}>
            <Input
              value={draft.description}
              placeholder={serviceLabel(service, t)}
              onChange={(event) => patch({ description: event.target.value })}
              disabled={disabled}
              enterKeyHint="next"
              data-testid={`v2-item-description-${index}`}
            />
          </Field>
          <Field label={t("v2.quantity")}>
            <Input
              inputMode="numeric"
              value={draft.quantity}
              onChange={(event) => patch({ quantity: event.target.value })}
              aria-invalid={errors.has("quantity") || undefined}
              className={`tnum ${errors.has("quantity") ? "!border-danger" : ""}`}
              disabled={disabled}
              data-testid={`v2-item-quantity-${index}`}
            />
          </Field>
        </div>

        <div className="col-span-2 grid grid-cols-2 gap-2 sm:contents">
          {costPriced ? (
            <Field label={t("v2.cost")}>
              <MoneyInput
                value={draft.cost}
                onChange={(value) => onChange(withCost(draft, value, serviceTypes))}
                invalid={errors.has("cost")}
                disabled={disabled}
                testId={`v2-item-cost-${index}`}
              />
            </Field>
          ) : (
            <span className="hidden sm:block" aria-hidden />
          )}
          <Field label={t("v2.finalPrice")} className={costPriced ? "" : "col-span-2 sm:col-span-1"}>
            <MoneyInput
              value={draft.finalPrice}
              placeholder={t("v2.price.pending")}
              onChange={(value) => patch({ finalPrice: value, priceTouched: true })}
              invalid={errors.has("finalPrice")}
              disabled={disabled}
              testId={`v2-item-final-${index}`}
            />
          </Field>
        </div>

        {/* One button, placed beside the service on a phone and at the row end on a desktop. */}
        <RemoveButton
          onClick={onRemove}
          index={index}
          className="col-start-2 row-start-1 flex self-end sm:col-start-6 sm:self-start"
        />
      </div>

      {addingService && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:ml-[calc(8.5rem+0.75rem)]" data-testid="v2-new-service">
          <Input
            autoFocus
            value={serviceName}
            aria-label={t("v2.newServiceName")}
            placeholder={t("v2.newServicePlaceholder")}
            onChange={(event) => setServiceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addService();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setAddingService(false);
              }
            }}
            className="min-w-0 flex-1 basis-40"
            data-testid="v2-new-service-name"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void addService()}
            disabled={savingService || !serviceName.trim()}
            data-testid="v2-new-service-add"
          >
            {t("v2.add")}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setAddingService(false)} disabled={savingService}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {costPriced && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted sm:ml-[calc(8.5rem+0.75rem)]">
          <span>
            {t("v2.recommended")}{" "}
            <span className="tnum text-text" data-testid={`v2-item-recommended-${index}`}>
              {recommended == null ? "—" : moneyExact(recommended)}
            </span>
            {cost != null && (
              <span className="text-faint">
                {" · "}
                {t("v2.margin", { percent: Math.round(printMarginFromCost(cost) * 100) })}
              </span>
            )}
          </span>
          {overridden && (
            <>
              <span className="text-faint">· {t("v2.manual")}</span>
              <button
                type="button"
                onClick={() => patch({ finalPrice: String(recommended), priceTouched: false })}
                className="font-medium text-accent hover:underline"
                data-testid={`v2-item-reset-${index}`}
              >
                {t("v2.resetToRecommended")}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-muted sm:sr-only">{label}</span>
      {children}
    </label>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  invalid,
  disabled,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <span className="relative block">
      {value !== "" && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-faint">$</span>
      )}
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        className={`tnum placeholder:text-[13px] ${value !== "" ? "pl-6" : ""} ${invalid ? "!border-danger" : ""}`}
        disabled={disabled}
        data-testid={testId}
      />
    </span>
  );
}

function RemoveButton({ onClick, index, className = "" }: { onClick: () => void; index: number; className?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("v2.removeItem")}
      title={t("v2.removeItem")}
      className={`h-11 w-9 items-center justify-center rounded-full text-faint transition-colors hover:bg-fill hover:text-danger ${className}`}
      data-testid={`v2-item-remove-${index}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[17px] w-[17px]" aria-hidden="true">
        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}
