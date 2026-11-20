"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { api, useData, useI18n, useSession } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { NewProjectModal } from "@/components/billing-v2/new-project-modal";
import { can } from "@/lib/auth/roles";
import { selectableClients } from "@/lib/billing-v2/board";
import { projectMatches, projectStatuses, type ProjectView, type WorkKind } from "@/lib/billing-v5/project-view";
import { useV5T } from "@/lib/billing-v5/i18n";
import { moneyExact } from "@/lib/format";
import { useWorkspaceT } from "@/lib/billing-v5/workspace-i18n";
import { useProjectViews } from "./workspace-shell";
import { Amount, BILLING, projectHref, ProjectStatusBadges, WorkspaceHeading, WorkspaceState } from "./workspace-parts";
import { ProjectDetailView } from "./project-view-detail";

const archiveStatuses = ["completed", "unpaid"] as const;
const sorts = ["newest", "oldest", "highest", "lowest", "name"] as const;
const kindOptions = ["all", "design", "print", "other"] as const;

export function ProjectRows({ rows, query = "", selected, selection }: {
  rows: ProjectView[];
  query?: string;
  selected?: string;
  selection?: { ids: Set<string>; eligible: Set<string>; toggle: (id: string) => void };
}) {
  const t = useWorkspaceT();
  const khr = new Intl.NumberFormat("en-US");
  if (!rows.length) return <WorkspaceState>{t("emptyProjects")}</WorkspaceState>;
  return (
    <ul className={`bw-project-rows${selection?.eligible.size ? " bw-project-rows-selectable" : ""}`}>
      {rows.map((view) => (
        <li key={view.project.id}>
          {selection?.eligible.has(view.project.id) && <label className="bw-checkbox">
            <input type="checkbox" checked={selection.ids.has(view.project.id)} onChange={() => selection.toggle(view.project.id)} />
            <span className="sr-only">{view.project.name}</span>
          </label>}
          <Link className="bw-project-row" href={projectHref(view.project.id, query)} aria-current={view.project.id === selected ? "page" : undefined} data-testid="billing-project-row" data-layout-group>
            <span className="bw-project-name"><strong>{view.project.name}</strong><small>{view.client || "—"}</small></span>
            <span className="bw-project-kinds" title={view.kinds.map((kind) => t(kind)).join(" · ")}>
              {view.kinds.slice(0, 2).map((kind) => <span key={kind} className="bw-badge">{t(kind)}</span>)}
              {view.kinds.length > 2 && <span className="bw-badge" data-more>+{view.kinds.length - 2}</span>}
            </span>
            <ProjectStatusBadges view={view} />
            <time className="bw-project-date" dateTime={view.project.date}>{view.project.date}</time>
            <span className="bw-project-amount" title={view.estimatedKhr == null ? undefined : `${t("estimate")} ${khr.format(view.estimatedKhr)} ៛`}>
              <Amount usd={view.amount} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProjectsWorkspace({ id, archive = false }: { id?: string; archive?: boolean }) {
  const t = useWorkspaceT();
  const v5 = useV5T();
  const { t: common } = useI18n();
  const { snapshot } = useData();
  const { user } = useSession();
  const projects = useProjectViews();
  const router = useRouter();
  const params = useSearchParams();
  const source = params.get("source");
  const archiveView = archive || Boolean(id && source === "archive");
  const listPath = BILLING + (archiveView ? "/archive" : "/projects");
  const path = id ? projectHref(id) : listPath;
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [selection, setSelection] = useState<{ status: string; ids: Set<string> }>({ status: "", ids: new Set() });
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useAction();
  const statuses = archiveView ? archiveStatuses : projectStatuses;
  const defaultStatus = archiveView ? "completed" : "all";
  const status = statuses.find((value) => value === params.get("status")) ?? defaultStatus;
  const kind = kindOptions.find((value) => value === params.get("kind")) ?? "all";
  const sort = sorts.find((value) => value === params.get("sort")) ?? "newest";
  const query = params.get("q") ?? "";
  const clientId = params.get("client") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const min = params.get("min") ?? "";
  const max = params.get("max") ?? "";
  const advancedActive = Boolean(from || to || min || max);
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);
  const hasFilters = Boolean(query || clientId || kind !== "all" || from || to || min || max || sort !== "newest");
  const clients = [...new Map(projects.filter((view) => view.client).map((view) => [view.project.clientId, view.client]))]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const detail = projects.find((view) => view.project.id === id);

  if (id && source === "design") {
    return <div className="bw-page"><ProjectDetailView key={id} view={detail} closeHref={BILLING} query="source=design" /></div>;
  }

  function queryWith(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return next.toString();
  }

  function setFilter(key: string, value: string) {
    const next = queryWith({ [key]: value });
    window.history.replaceState(null, "", next ? `${path}?${next}` : path);
  }

  const filtered = projects.filter((view) =>
    (status === "draft" ? view.draft : status === "progress" || !view.draft) &&
    (status === "draft" || status === "all"
      || status === "unpaid" && (view.collection === "outstanding" || view.collection === "partial")
      || view.status === status) &&
    (kind === "all" || view.kinds.includes(kind as WorkKind)) &&
    (!clientId || view.project.clientId === clientId) &&
    (!from || view.project.date >= from) && (!to || view.project.date <= to) &&
    (!min || view.amount != null && view.amount >= Number(min)) &&
    (!max || view.amount != null && view.amount <= Number(max)) &&
    projectMatches(view, query),
  ).sort((a, b) => {
    if (sort === "name") return a.project.name.localeCompare(b.project.name);
    if (sort === "oldest") return a.project.date.localeCompare(b.project.date);
    if (sort === "highest" || sort === "lowest") {
      if (a.amount == null) return b.amount == null ? 0 : 1;
      if (b.amount == null) return -1;
      return sort === "highest" ? b.amount - a.amount : a.amount - b.amount;
    }
    return b.project.date.localeCompare(a.project.date) || b.project.createdAt.localeCompare(a.project.createdAt);
  });

  const canSelect = !id && (status === "progress" || status === "ready") && user && can(user.role, "billing:price:write");
  const selectable = new Set(canSelect ? filtered.filter((view) =>
    view.pending && view.pending.billingReadiness !== "ACCOUNTING" && view.status === status,
  ).map((view) => view.project.id) : []);
  const selected = new Set(selection.status === status ? [...selection.ids].filter((key) => selectable.has(key)) : []);
  const chosen = filtered.filter((view) => selected.has(view.project.id));
  const chosenTotal = chosen.reduce((sum, view) => sum + (view.pending?.total ?? 0), 0);
  const hasUnpriced = chosen.some(({ pending }) => !pending?.items.length || pending.pricePendingCount > 0);
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection({ status, ids: next });
  }

  async function setReadiness(readiness: "READY" | "IN_PROGRESS" | "ACCOUNTING") {
    const changed = await run(async () => {
      for (const view of chosen) {
        await api(`/api/projects/${view.project.id}/readiness`, { method: "PATCH", body: { readiness } });
      }
    }, readiness === "ACCOUNTING" ? undefined : {
      key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done",
    });
    if (changed) {
      setSelection({ status, ids: new Set() });
      setConfirming(false);
    }
  }

  const serialized = queryWith({ source: archiveView ? "archive" : "" });
  const listQuery = queryWith({ source: "" });
  const closeHref = listQuery ? `${listPath}?${listQuery}` : listPath;
  const clearParams = queryWith({ q: "", kind: "", client: "", from: "", to: "", min: "", max: "", sort: "", source: "" });
  const title = archiveView ? t("archive") : kind === "all" ? t("projects") : t(kind);

  return (
    <div className={`bw-page${id ? " bw-detail-open" : ""}`} data-testid="billing-projects">
      <div className={id ? "bw-project-list-header bw-hide-with-detail" : "bw-project-list-header"}>
        <WorkspaceHeading title={title} actions={
          <>
            {archiveView ? <>
              <Link className="bw-control" href={`${BILLING}/tax-invoices?collection=paid`}>{t("paidInvoices")}</Link>
              <Link className="bw-control" href={`${BILLING}/price-history`}>{t("prices")}</Link>
            </> : <Link className="bw-control" href={`${BILLING}/tax-invoices`}>{t("invoices")}</Link>}
            {!archiveView && user && can(user.role, "production:write") && (
              <Button variant="primary" onClick={() => setCreating(true)} data-testid="v2-new-project">+ {common("v2.newProject")}</Button>
            )}
          </>
        } />
        <div className="bw-filter-panel">
          <nav className="bw-tabs" aria-label={t("status")} aria-describedby={status === "completed" ? "bw-completed-help" : undefined} data-layout-group>
            {statuses.map((key) => {
              const next = queryWith({ status: key === defaultStatus ? "" : key, source: "" });
              const label = key === "unpaid" ? "balanceDue" : key === "completed" ? "archivedProjects" : key;
              return <Link key={key} href={next ? `${listPath}?${next}` : listPath} aria-current={status === key ? "page" : undefined}>{t(label)}</Link>;
            })}
          </nav>
          <div className="bw-filters bw-project-filters" data-layout-group>
            <input className="bw-input bw-wide" type="search" aria-label={t("searchProjects")} placeholder={t("searchProjects")} value={query} onChange={(event) => setFilter("q", event.target.value)} data-testid="billing-project-search" />
            <select className="bw-input" aria-label={t("kind")} value={kind} onChange={(event) => setFilter("kind", event.target.value)}>
              {kindOptions.map((key) => <option key={key} value={key}>{t(key === "all" ? "allKinds" : key)}</option>)}
            </select>
            <select className="bw-input" aria-label={t("customer")} value={clientId} onChange={(event) => setFilter("client", event.target.value)}>
              <option value="">{t("allCustomers")}</option>
              {clients.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
            <select className="bw-input" aria-label={t("sort")} value={sort} onChange={(event) => setFilter("sort", event.target.value)}>
              {sorts.map((key) => <option key={key} value={key}>{t(key)}</option>)}
            </select>
            <button type="button" className="bw-control bw-filter-toggle" aria-expanded={advancedOpen} aria-controls="bw-advanced-filters" data-active={advancedActive || undefined} onClick={() => setAdvancedOpen((open) => !open)}>{t("filters")}</button>
          </div>
          <div className="bw-filters bw-dates" id="bw-advanced-filters" hidden={!advancedOpen} data-layout-group>
            <label><span>{t("from")}</span><input className="bw-input" type="date" value={from} onChange={(event) => setFilter("from", event.target.value)} /></label>
            <label><span>{t("to")}</span><input className="bw-input" type="date" value={to} onChange={(event) => setFilter("to", event.target.value)} /></label>
            <label><span>{t("min")}</span><input className="bw-input" type="number" min="0" step="0.01" value={min} onChange={(event) => setFilter("min", event.target.value)} /></label>
            <label><span>{t("max")}</span><input className="bw-input" type="number" min="0" step="0.01" value={max} onChange={(event) => setFilter("max", event.target.value)} /></label>
          </div>
          {status === "completed" && <p className="bw-filter-help" id="bw-completed-help">{t("completedHelp")}</p>}
        </div>
      </div>
      <div className={id ? "bw-project-split" : undefined}>
        <section className={id ? "bw-hide-with-detail" : undefined} aria-label={t("projects")}>
          <div className="bw-result-summary" data-layout-group>
            <span>{filtered.length} {t("result")}</span>
            {hasFilters && <Link className="bw-text-link" href={clearParams ? `${listPath}?${clearParams}` : listPath}>{t("clear")}</Link>}
          </div>
          {chosen.length > 0 && <div className="bw-selection bw-card" data-layout-group>
            <span>{common("v2.selected", { count: chosen.length })} · {moneyExact(chosenTotal)}</span>
            <div className="bw-actions">
              {status === "ready"
                ? <>
                  <Button variant="secondary" disabled={busy} onClick={() => void setReadiness("IN_PROGRESS")}>{common("v2.moveInProgress")}</Button>
                  <Button variant="primary" disabled={busy || hasUnpriced} onClick={() => setConfirming(true)}>{v5("design.sendAccounting")}</Button>
                </>
                : <Button variant="primary" disabled={busy || hasUnpriced} onClick={() => void setReadiness("READY")}>{common("v2.markReady")}</Button>}
            </div>
          </div>}
          <ProjectRows rows={filtered} query={serialized} selected={id} selection={canSelect ? { ids: selected, eligible: selectable, toggle } : undefined} />
        </section>
        {id && <ProjectDetailView key={id} view={detail} closeHref={closeHref} query={serialized} />}
      </div>
      <ConfirmDialog open={confirming} busy={busy} onClose={() => setConfirming(false)}
        onConfirm={() => void setReadiness("ACCOUNTING")}
        title={v5("design.sendAccountingTitle")}
        message={v5("design.sendAccountingBody", { count: chosen.length, total: moneyExact(chosenTotal) })}
        confirmLabel={v5("design.sendAccounting")} testId="billing-confirm-bulk-handoff"
      />
      {creating && snapshot && user && can(user.role, "production:write") && <NewProjectModal
        clients={selectableClients(snapshot.clients)}
        onClose={() => setCreating(false)}
        onCreated={(projectId) => router.push(projectHref(projectId))}
      />}
    </div>
  );
}
