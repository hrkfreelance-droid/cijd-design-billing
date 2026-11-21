"use client";

import { useId, useMemo, useRef, useState } from "react";
import { moneyExact } from "@/lib/format";
import { useSuggestionT } from "@/lib/billing-v5/suggestion-i18n";
import { suggestionsFor, type ServiceSuggestion, type SuggestionIndex } from "@/lib/billing-v5/service-suggestions";
import { priceEstimateFor, type PriceEstimate, type PriceQuery } from "@/lib/billing-v5/service-price-estimates";
import { estimateBasis, estimateSummary, ServicePriceEstimate } from "./service-price-estimate";

export function ServicePicker({ index, customerId, projectId, disabled, onPick, testId, priceQuery }: {
  index: SuggestionIndex; customerId: string; projectId: string; disabled: boolean;
  onPick: (suggestion: ServiceSuggestion) => void; testId: string;
  priceQuery: Omit<PriceQuery, "description" | "projectId">;
}) {
  const t = useSuggestionT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [visibleCount, setVisibleCount] = useState(60);
  const input = useRef<HTMLInputElement>(null);
  const { quantity, serviceKey, unit } = priceQuery;
  const options = useMemo(() => {
    // Hide placeholder history rows such as "(unconfirmed)" with no price (Opus 11/21).
    const rows = suggestionsFor(index, customerId, projectId, query).filter((row) => !/^\(.*\)$/.test(String(row.name ?? "").trim()) && !(row.price === 0 && !row.formatId));
    if (rows.length || !query.trim()) return rows;
    const estimate = priceEstimateFor(index, { description: query, quantity, serviceKey, unit, projectId });
    return [{ id: "new-description", name: query.trim(), description: query.trim(), serviceKey, quantity,
      unit: unit || estimate?.unit || "", price: estimate?.price ?? null, source: "history" as const,
      date: null, count: estimate?.samples.length ?? 0, ...(estimate ? { estimate } : {}) }];
  }, [index, customerId, projectId, query, quantity, serviceKey, unit]);
  const pick = (option: ServiceSuggestion) => {
    onPick(option);
    setOpen(false);
    setQuery("");
    input.current?.focus();
  };
  return <div className="ss-picker" data-testid={testId} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label className="ss-label" htmlFor={id}>{t("choose")}</label>
    <div className="ss-search">
      <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
        aria-autocomplete="list" aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
        placeholder={t("search")} value={query} disabled={disabled} autoComplete="off"
        onFocus={() => { setOpen(true); setActive(0); }} onClick={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setVisibleCount(60); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            const next = Math.max(0, Math.min(options.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
            setActive(next);
            if (next >= visibleCount) setVisibleCount(next + 60);
            requestAnimationFrame(() => document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" }));
          } else if (event.key === "Enter" && open && options[active]) {
            event.preventDefault(); pick(options[active]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false);
          }
        }} />
      {open && <button type="button" aria-label={t("close")} onClick={() => setOpen(false)}>×</button>}
    </div>
    {open && <div className="ss-results" data-testid={`${testId}-results`}>
      <ul id={`${id}-list`} role="listbox" aria-label={t("choose")}>
        {!options.length && <li className="ss-empty" role="presentation">{t("empty")}</li>}
        {options.slice(0, visibleCount).map((option, n) => {
          const group = option.group ?? (option.formatId ? "formats" : option.source === "customer" ? "customer" : "history");
          const previous = options[n - 1];
          const previousGroup = !previous ? null : previous.group ?? (previous.formatId ? "formats" : previous.source === "customer" ? "customer" : "history");
          return <li key={option.id} role="presentation">
            {previousGroup !== group && <div className="ss-group" role="presentation">{t(group)}</div>}
            <div id={`${id}-${n}`} role="option" aria-selected={active === n} className="ss-option"
              aria-setsize={options.length} aria-posinset={n + 1}
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(n)} onClick={() => pick(option)}
              data-source={option.source} data-format={Boolean(option.formatId)} title={option.estimate ? estimateBasis(option.estimate, t) : undefined}>
              <div className="ss-option-title"><strong>{option.name}</strong><span className="tnum">{option.price == null ? t("pending") : moneyExact(option.price)}</span></div>
              {option.estimate && <small>{estimateSummary(option.estimate, t)}{option.estimate.samples.length < 3 ? ` · ${t("sparse")}` : ""}</small>}
              <small>{[option.formatId ? option.description : null, `${option.quantity} ${option.unit}`.trim(),
                option.source === "customer" ? `${t("previous")} ${option.date}` : t("estimate"),
                option.count ? `${option.count} ${t("uses")}` : null,
                option.source === "history" ? option.customer : null].filter(Boolean).join(" · ")}</small>
            </div>
          </li>;
        })}
      </ul>
      {options.length > visibleCount && <button type="button" className="ss-more" onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisibleCount((count) => count + 60)}>{t("more")} · {visibleCount} / {options.length}</button>}
    </div>}
  </div>;
}

export function SuggestionSource({ suggestion, price, customerId }: {
  suggestion?: { source: ServiceSuggestion["source"]; date: string | null; price: number | null; customerId: string; estimate?: PriceEstimate };
  price: string; customerId: string;
}) {
  const t = useSuggestionT();
  if (!suggestion || suggestion.customerId !== customerId || suggestion.price === null || !price.trim() || Number(price) !== suggestion.price) return null;
  if (suggestion.estimate) return <ServicePriceEstimate estimate={suggestion.estimate} testId="v5-price-source" />;
  return <p className="ss-source" data-testid="v5-price-source">
    {suggestion.source === "customer" ? `${t("previous")} ${suggestion.date}` : t("estimate")} · {moneyExact(suggestion.price)}
  </p>;
}
