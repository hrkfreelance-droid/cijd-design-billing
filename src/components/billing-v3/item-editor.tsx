"use client";

import { useState, type ReactNode } from "react";

import { useI18n } from "@/components/providers";
import { Button, Input, Select } from "@/components/ui";
import { isCostPriced, serviceLabel, serviceOptions, type ServiceKey } from "@/lib/billing-v2/services";
import { effectiveMarkupPercent, formatPercent } from "@/lib/billing-v2/pricing";
import { evaluateMoneyExpression } from "@/lib/expr";
import { moneyExact } from "@/lib/format";
import type { ServiceType } from "@/lib/types";
import {
  draftErrors,
  draftFinal,
  draftIsManual,
  draftRecommended,
  draftService,
  draftTotalCost,
  withRecommended,
  withDefaultMarkup,
  withFinalTotal,
  withFinalUnit,
  withMarkup,
  withQuantity,
  withService,
  withUnitCost,
  type ItemDraft,
} from "./item-draft";

const NEW_SERVICE = "__new__";

/** Small caps field label, shown on every screen size. */
const LABEL = "mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-faint";
const PANEL_LABEL = "mb-1 block text-[11px] text-muted";

/**
 * One line item, open for editing.
 *
 * Two tiers: what the line is (service, description, quantity), then how it
 * is priced. The pricing tier reads left to right in the order the numbers
 * are derived — Cost, Markup, Recommended — and ends on Final, the only
 * number that is billed, which carries the emphasis. Recommended is text,
 * never a field: it is a reference, not something to edit.
 *
 * The fields a service actually has come from the registry: only a cost-priced
 * service shows Cost, Markup and Recommended, so adding a service never means
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
  const errors = draftErrors(draft, serviceTypes);
  const manual = draftIsManual(draft, serviceTypes);
  const effective = effectiveMarkupPercent(final, totalCost);

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

  const setService = (key: string) => {
    if (key === NEW_SERVICE) {
      setAddingService(true);
      return;
    }
    onChange(withService(draft, key as ServiceKey, serviceTypes));
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
      onChange(withService(draft, key, serviceTypes));
    }
  };

  const available = serviceOptions(serviceTypes);
  const options = available.some((entry) => entry.key === service.key) ? available : [service, ...available];

  return (
    <div className="border-b border-line py-4" data-testid="v2-item">
      {/* What the line is. */}
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_2.25rem] items-end gap-x-2 gap-y-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_5rem_2.25rem]">
        <Field label={t("v2.service")} className="col-span-2 sm:col-span-1">
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
        <RemoveButton
          onClick={onRemove}
          index={index}
          className="col-start-3 row-start-1 flex sm:col-start-4"
        />
        <Field label={t("v2.description")} className="col-span-1 sm:col-start-2 sm:row-start-1">
          <Input
            value={draft.description}
            placeholder={serviceLabel(service, t)}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            disabled={disabled}
            enterKeyHint="next"
            data-testid={`v2-item-description-${index}`}
          />
        </Field>
        <Field label={t("v2.quantity")} className="col-span-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
          <Input
            inputMode="decimal"
            value={draft.quantity}
            onChange={(event) => onChange(withQuantity(draft, event.target.value, serviceTypes))}
            aria-invalid={errors.has("quantity") || undefined}
            className={`tnum ${errors.has("quantity") ? "!border-danger" : ""}`}
            disabled={disabled}
            data-testid={`v2-item-quantity-${index}`}
          />
        </Field>
      </div>

      {addingService && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="v2-new-service">
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

      {/* How it is priced. */}
      <div
        className={`mt-3.5 grid gap-3 ${costPriced ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-start md:gap-5" : ""}`}
      >
        {costPriced && (
          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
            <Field label={t("v2.cost")}>
              <MoneyInput
                value={draft.unitCost}
                onChange={(value) => onChange(withUnitCost(draft, value, serviceTypes))}
                invalid={errors.has("cost")}
                disabled={disabled}
                ariaLabel={t("v2.unitCost")}
                testId={`v2-item-unit-cost-${index}`}
              />
              <Note>
                <span className="text-faint">{t("v3.costTotal")} </span>
                <span className="tnum text-muted" data-testid={`v3-item-total-cost-${index}`}>
                  {totalCost == null ? "—" : moneyExact(totalCost)}
                </span>
              </Note>
            </Field>

            <Field label={t("v3.markup")}>
              <span className="relative block">
                <Input
                  inputMode="decimal"
                  value={draft.markup}
                  placeholder="—"
                  onChange={(event) => onChange(withMarkup(draft, event.target.value, serviceTypes))}
                  aria-label={t("v3.markup")}
                  aria-invalid={errors.has("markup") || undefined}
                  className={`tnum pr-7 ${errors.has("markup") ? "!border-danger" : ""}`}
                  disabled={disabled || totalCost == null}
                  data-testid={`v3-item-markup-${index}`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-faint">%</span>
              </span>
              <Note wrap>
                {draft.markupTouched ? (
                  <>
                    <span className="text-muted" data-testid={`v3-item-markup-manual-${index}`}>
                      {t("v3.manual")}
                    </span>
                    <span className="text-faint" aria-hidden>·</span>
                    <button
                      type="button"
                      onClick={() => onChange(withDefaultMarkup(draft, serviceTypes))}
                      disabled={disabled}
                      className="font-medium text-accent hover:underline disabled:text-faint"
                      data-testid={`v3-item-markup-reset-${index}`}
                    >
                      {t("v3.markup.reset")}
                    </button>
                  </>
                ) : (
                  <span className="text-faint" data-testid={`v3-item-markup-default-${index}`}>
                    {t("v3.markup.default")}
                  </span>
                )}
              </Note>
            </Field>

            <div className="min-w-0">
              <span className={LABEL}>{t("v2.recommended")}</span>
              <span
                className="tnum flex h-11 items-center text-[15px] text-muted"
                data-testid={`v2-item-recommended-${index}`}
              >
                {recommended == null ? "—" : moneyExact(recommended)}
              </span>
            </div>
          </div>
        )}

        <FinalPanel
          draft={draft}
          index={index}
          disabled={disabled}
          errors={errors}
          manual={manual}
          costPriced={costPriced}
          effective={effective}
          canUseRecommended={costPriced && recommended != null}
          onUnit={(value) => onChange(withFinalUnit(draft, value, serviceTypes))}
          onTotal={(value) => onChange(withFinalTotal(draft, value, serviceTypes))}
          onUseRecommended={() => onChange(withRecommended(draft, serviceTypes))}
        />
      </div>
    </div>
  );
}

/**
 * Final is the actual bill: Unit Price and Total, either of which can be
 * typed. The panel is the one filled surface in the row so the eye lands on
 * it; its status line says whether it follows Recommended or was set by hand.
 */
function FinalPanel({
  draft,
  index,
  disabled,
  errors,
  manual,
  costPriced,
  effective,
  canUseRecommended,
  onUnit,
  onTotal,
  onUseRecommended,
}: {
  draft: ItemDraft;
  index: number;
  disabled: boolean;
  errors: Set<string>;
  manual: boolean;
  costPriced: boolean;
  effective: number | null;
  canUseRecommended: boolean;
  onUnit: (value: string) => void;
  onTotal: (value: string) => void;
  onUseRecommended: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-[14px] bg-fill px-3 pb-2.5 pt-2.5" data-testid={`v3-item-final-panel-${index}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text">{t("v3.final")}</span>
        {costPriced && (
          <span
            className={`inline-flex items-center gap-1.5 text-[11.5px] ${manual ? "font-medium text-text" : "text-faint"}`}
            data-testid={`v3-item-final-mode-${index}`}
            data-mode={manual ? "manual" : "auto"}
          >
            {manual && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
            {manual ? t("v3.manual") : t("v3.auto")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
        <Field label={t("v3.unitPrice")} labelClassName={PANEL_LABEL}>
          <MoneyInput
            value={draft.finalUnitPrice}
            onChange={onUnit}
            invalid={errors.has("finalUnit")}
            disabled={disabled}
            testId={`v3-item-final-unit-${index}`}
          />
        </Field>
        <Field label={t("v3.total")} labelClassName={PANEL_LABEL}>
          <MoneyInput
            value={draft.finalPrice}
            placeholder={t("v2.price.pending")}
            onChange={onTotal}
            invalid={errors.has("finalPrice")}
            disabled={disabled}
            strong
            testId={`v2-item-final-${index}`}
          />
        </Field>
      </div>
      {costPriced && (manual || effective != null) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          {effective != null && (
            <span className="tnum" data-testid={`v3-item-effective-markup-${index}`}>
              {t("v3.effectiveMarkup", { percent: `${effective >= 0 ? "+" : ""}${formatPercent(effective)}` })}
            </span>
          )}
          {manual && canUseRecommended && (
            <button
              type="button"
              onClick={onUseRecommended}
              disabled={disabled}
              className="font-medium text-accent hover:underline disabled:text-faint"
              data-testid={`v2-item-reset-${index}`}
            >
              {t("v2.resetToRecommended")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  className = "",
  labelClassName = LABEL,
  children,
}: {
  label: string;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className={labelClassName}>{label}</span>
      {children}
    </label>
  );
}

function Note({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <span
      className={`mt-1 text-[12px] leading-tight ${wrap ? "flex flex-wrap items-baseline gap-x-1 gap-y-0.5" : "block truncate"}`}
    >
      {children}
    </span>
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
  strong = false,
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  strong?: boolean;
  ariaLabel?: string;
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
        <span className="pointer-events-none absolute left-3 top-[22px] -translate-y-1/2 text-[15px] text-faint">$</span>
      )}
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        aria-invalid={invalid || undefined}
        className={`tnum placeholder:text-[13px] ${value !== "" ? "pl-6" : ""} ${strong ? "font-semibold" : ""} ${invalid ? "!border-danger" : ""}`}
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
