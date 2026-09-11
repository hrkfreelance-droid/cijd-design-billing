"use client";

import { useState, type ReactNode } from "react";

import { useI18n } from "@/components/providers";
import { Button, Input, Select } from "@/components/ui";
import { isCostPriced, serviceLabel, serviceOptions, type ServiceKey } from "@/lib/billing-v2/services";
import { printMarginFromCost } from "@/lib/billing-v2/pricing";
import { evaluateMoneyExpression } from "@/lib/expr";
import { moneyExact } from "@/lib/format";
import type { ServiceType } from "@/lib/types";
import {
  draftErrors,
  draftFinal,
  draftRecommended,
  draftService,
  draftTotalCost,
  withQuantity,
  withTotalCost,
  withUnitCost,
  type ItemDraft,
} from "./item-draft";

const NEW_SERVICE = "__new__";

/** Desktop column rhythm shared by the header row and every line. */
export const EDIT_GRID =
  "sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_3.5rem_5.5rem_5.75rem_6.5rem_2.25rem] sm:items-start sm:gap-x-2.5";

/** Column headings for the edit list; phones label each field instead. */
export function ItemEditorHeader({ showCost }: { showCost: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`hidden pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint ${EDIT_GRID}`}>
      <span>{t("v2.service")}</span>
      <span>{t("v2.description")}</span>
      <span>{t("v2.quantity")}</span>
      <span>{showCost ? t("v2.unitCost") : ""}</span>
      <span>{showCost ? t("v2.totalCost") : ""}</span>
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
  const totalCost = draftTotalCost(draft, serviceTypes);
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
    if (!isCostPriced(draftService(next, serviceTypes))) {
      next.unitCost = "";
      next.totalCost = "";
    }
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
      onChange({ ...draft, serviceKey: key, unitCost: "", totalCost: "" });
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
              onChange={(event) => onChange(withQuantity(draft, event.target.value, serviceTypes))}
              aria-invalid={errors.has("quantity") || undefined}
              className={`tnum ${errors.has("quantity") ? "!border-danger" : ""}`}
              disabled={disabled}
              data-testid={`v2-item-quantity-${index}`}
            />
          </Field>
        </div>

        {costPriced ? (
          <div className="col-span-2 grid grid-cols-2 gap-2 sm:contents">
            <Field label={t("v2.unitCost")}>
              <MoneyInput
                value={draft.unitCost}
                onChange={(value) => onChange(withUnitCost(draft, value, serviceTypes))}
                invalid={errors.has("cost") && draft.costMode === "UNIT"}
                disabled={disabled}
                testId={`v2-item-unit-cost-${index}`}
              />
            </Field>
            <Field label={t("v2.totalCost")}>
              <MoneyInput
                value={draft.totalCost}
                onChange={(value) => onChange(withTotalCost(draft, value, serviceTypes))}
                invalid={errors.has("cost") && draft.costMode === "TOTAL"}
                disabled={disabled}
                testId={`v2-item-total-cost-${index}`}
              />
            </Field>
          </div>
        ) : (
          <>
            <span className="hidden sm:block" aria-hidden />
            <span className="hidden sm:block" aria-hidden />
          </>
        )}
        <Field label={t("v2.finalPrice")} className="col-span-2 sm:col-span-1">
          <MoneyInput
            value={draft.finalPrice}
            placeholder={t("v2.price.pending")}
            onChange={(value) => patch({ finalPrice: value, priceTouched: true })}
            invalid={errors.has("finalPrice")}
            disabled={disabled}
            testId={`v2-item-final-${index}`}
          />
        </Field>

        {/* One button, placed beside the service on a phone and at the row end on a desktop. */}
        <RemoveButton
          onClick={onRemove}
          index={index}
          className="col-start-2 row-start-1 flex self-end sm:col-start-7 sm:self-start"
        />
      </div>

      {addingService && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:ml-[calc(7rem+0.625rem)]" data-testid="v2-new-service">
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
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted sm:ml-[calc(7rem+0.625rem)]">
          <span>
            {t("v2.recommended")}{" "}
            <span className="tnum text-text" data-testid={`v2-item-recommended-${index}`}>
              {recommended == null ? "—" : moneyExact(recommended)}
            </span>
            {totalCost != null && (
              <span className="text-faint">
                {" · "}
                {t("v2.margin", { percent: Math.round(printMarginFromCost(totalCost) * 100) })}
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

/**
 * A money field that also accepts a `4.3*150`-style expression: it stays as
 * typed while editing, and on Enter or blur collapses to the computed number
 * — that number is what gets saved, never the formula.
 */
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
  const { t } = useI18n();
  const trimmed = value.trim();
  const isExpression = /[+\-*/()]/.test(trimmed);
  const result = trimmed ? evaluateMoneyExpression(trimmed) : null;

  const commit = () => {
    if (result?.ok && isExpression) {
      const formatted = result.value.toFixed(2);
      if (formatted !== value) onChange(formatted);
    }
  };

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
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        aria-invalid={invalid || undefined}
        className={`tnum placeholder:text-[13px] ${value !== "" ? "pl-6" : ""} ${invalid ? "!border-danger" : ""}`}
        disabled={disabled}
        data-testid={testId}
      />
      {result?.ok && isExpression && (
        <span className="mt-0.5 block text-[11px] leading-tight text-faint">{`= ${moneyExact(result.value)}`}</span>
      )}
      {result && !result.ok && (
        <p
          role="alert"
          className="mt-0.5 text-[11px] leading-tight text-danger"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          {t("v2.invalidAmount")}
        </p>
      )}
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
