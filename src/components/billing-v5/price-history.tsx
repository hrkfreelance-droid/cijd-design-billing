"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { matchesSearch, normalizeSearch, priceHistory, type PriceEntry } from "@/lib/billing-v5/project-view";
import { useWorkspaceT } from "@/lib/billing-v5/workspace-i18n";
import { useProjectViews } from "./workspace-shell";
import { Amount, BILLING, projectHref, WorkspaceHeading, WorkspaceState } from "./workspace-parts";

export function PriceRows({ rows }: { rows: PriceEntry[] }) {
  const t = useWorkspaceT();
  if (!rows.length) return <WorkspaceState />;
  return <ul className="bw-price-rows">{rows.map((entry) => (
    <li key={entry.id} data-layout-group>
      <div><strong>{entry.name}</strong><small>{entry.date || "—"} · {entry.view.client || "—"}</small></div>
      <div><Link className="bw-text-link" href={projectHref(entry.view.project.id)}>{entry.view.project.name}</Link>
        <small>{entry.quantity.toLocaleString()} {entry.unit ?? ""}</small></div>
      <Amount usd={entry.price} />
      <span className="sr-only">{t("price")}</span>
    </li>
  ))}</ul>;
}

export function PriceHistory() {
  const t = useWorkspaceT();
  const params = useSearchParams();
  const projects = useProjectViews();
  const initial = params.get("q") ?? "";
  const client = params.get("client") ?? "";
  return <PriceResults key={`${initial}|${client}`} initial={initial} client={client} projects={projects} t={t} />;
}

function PriceResults({ initial, client, projects, t }: { initial: string; client: string; projects: ReturnType<typeof useProjectViews>; t: ReturnType<typeof useWorkspaceT> }) {
  const [query, setQuery] = useState(initial);
  const history = useMemo(() => priceHistory(projects), [projects]);
  const entries = history.filter((entry) =>
    (!client || entry.view.project.clientId === client)
    && matchesSearch(normalizeSearch(`${entry.name} ${entry.view.project.name}`), query),
  );
  const exact = normalizeSearch(query);
  const matchingItem = exact ? entries.filter((entry) => normalizeSearch(entry.name) === exact) : [];
  const comparison = matchingItem.length ? matchingItem : entries;
  const hasComparison = comparison.length > 0 && new Set(comparison.map((entry) => normalizeSearch(entry.name))).size === 1;
  const bounds = hasComparison ? comparison.reduce(
    (range, entry) => ({ low: Math.min(range.low, entry.price), high: Math.max(range.high, entry.price) }),
    { low: comparison[0].price, high: comparison[0].price },
  ) : null;

  return <div className="bw-page" data-testid="billing-price-history">
    <WorkspaceHeading title={t("prices")} actions={client && <Link href={`${BILLING}/price-history`} className="bw-control">{t("all")}</Link>} />
    <div className="bw-filter-panel bw-simple-filter">
      <label><span>{t("searchPrices")}</span><input className="bw-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    {bounds && <dl className="bw-price-summary" data-layout-group>
      <div className="bw-card"><dt>{t("latestPrice")}</dt><dd><Amount usd={comparison[0].price} /></dd></div>
      <div className="bw-card"><dt>{t("lowestPrice")}</dt><dd><Amount usd={bounds.low} /></dd></div>
      <div className="bw-card"><dt>{t("highestPrice")}</dt><dd><Amount usd={bounds.high} /></dd></div>
    </dl>}
    {entries.length > 0 && !hasComparison && <p className="bw-hint">{t("priceReference")}</p>}
    <div className="bw-result-summary">{entries.length} {t("result")}</div>
    <PriceRows rows={entries} />
  </div>;
}
