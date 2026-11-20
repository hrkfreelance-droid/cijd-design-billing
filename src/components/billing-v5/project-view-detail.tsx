"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api, useData, useI18n, useSession } from "@/components/providers";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { ProjectModal } from "@/components/billing-v3/project-modal";
import { can, canAny } from "@/lib/auth/roles";
import { isBilled, selectableClients } from "@/lib/billing-v2/board";
import { useV5T } from "@/lib/billing-v5/i18n";
import { eligibleBilling } from "@/lib/billing-v5/ontology";
import { pricingCustomerIds, similarProjects, type ProjectInvoice, type ProjectPaymentView, type ProjectView } from "@/lib/billing-v5/project-view";
import { useWorkspaceT, type WorkspaceKey } from "@/lib/billing-v5/workspace-i18n";
import { moneyExact } from "@/lib/format";
import { InvoiceEditor } from "./invoice-editor";
import { usePricingCustomerCandidates, useProjectViews } from "./workspace-shell";
import { Amount, BILLING, InvoiceLink, projectHref, ProjectStatusBadges, WorkspaceState } from "./workspace-parts";

export function RecordRows({ invoices }: { invoices: ProjectInvoice[] }) {
  const t = useWorkspaceT();
  if (!invoices.length) return <WorkspaceState />;
  return <ul className="bw-records">{invoices.map((entry) => (
    <li key={entry.id} id={`invoice-${entry.id}`} data-layout-group>
      <div><InvoiceLink entry={entry} /><small>{[entry.date, entry.cancelled ? t("voided") : entry.paid ? t("collected") : entry.outstanding < entry.usd ? t("partial") : t("outstanding")].filter(Boolean).join(" · ") || "—"}</small></div>
      <Amount usd={entry.usd} khr={entry.khr} />
    </li>
  ))}</ul>;
}

export function PaymentRows({ payments, invoices }: { payments: ProjectPaymentView[]; invoices: ProjectInvoice[] }) {
  const t = useWorkspaceT();
  if (!payments.length) return <WorkspaceState />;
  const lookup = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  return <ul className="bw-records">{payments.map((payment) => {
    const invoice = payment.invoiceId ? lookup.get(payment.invoiceId) : undefined;
    const invoiceHref = invoice?.tax ? `${BILLING}/tax-invoices/${invoice.id}#invoice-payments` : null;
    return <li key={payment.id} data-layout-group>
      <div>
        <strong>{payment.date ?? "—"}</strong>
        <small>{[payment.actor, payment.deposit ? t("deposit") : null, payment.voided ? t("voided") : null].filter(Boolean).join(" · ")}</small>
        {invoiceHref && <Link className="bw-text-link" href={invoiceHref}>{invoice?.number ?? t("invoices")}</Link>}
      </div>
      <Amount usd={payment.amount} />
    </li>;
  })}</ul>;
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="bw-card bw-detail-section"><h2>{title}</h2>{children}</section>;
}

export function ProjectDetailView({ view, closeHref, query }: { view?: ProjectView; closeHref: string; query: string }) {
  const t = useWorkspaceT();
  if (!view) return <aside className="bw-project-detail">
    <Link className="bw-control" href={closeHref}>← {t("projects")}</Link>
    <WorkspaceState>{t("projectMissing")}</WorkspaceState>
  </aside>;
  return <ProjectDetails view={view} query={query} closeHref={closeHref} />;
}

function ProjectDetails({ view, query, closeHref }: { view: ProjectView; query: string; closeHref: string }) {
  const t = useWorkspaceT();
  const v5 = useV5T();
  const { t: common } = useI18n();
  const { snapshot } = useData();
  const { user } = useSession();
  const { busy, run } = useAction();
  const projects = useProjectViews();
  const candidates = usePricingCustomerCandidates();
  const [editing, setEditing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [handoff, setHandoff] = useState(false);
  if (!snapshot) return null;

  const { project, items, pending, invoices, payments } = view;
  const addedDate = project.note?.trim().match(/^Current active project added (\d{4}-\d{2}-\d{2})$/)?.[1];
  const note = addedDate ? t("currentProjectAdded").replace("{date}", addedDate) : project.note;
  const canEdit = Boolean(!view.readOnly && pending && user && canAny(user.role, ["production:write", "billing:price:write"]));
  const preparation = pending?.billingReadiness !== "ACCOUNTING" && canEdit;
  const ready = pending?.blocker === null;
  const invoiceToPay = invoices.find((entry) => entry.tax && !entry.cancelled && entry.outstanding > 0);
  const canIssue = Boolean(view.canIssue && user && canAny(user.role, ["invoice:write", "payment:write"]));
  const canPay = Boolean(!view.archivedImport && invoiceToPay && user && can(user.role, "payment:write"));
  const related = similarProjects(view, projects, pricingCustomerIds(project.clientId, candidates));
  const hasCost = items.some(({ item }) => item.printCost != null);
  const deliveries = items.filter(({ item }) => item.deliveredAt || item.deliveredBy)
    .map(({ item }) => ({ date: item.deliveredAt ?? null, actor: item.deliveredBy ?? null }));
  const issueRecords = (snapshot.noInvoiceIssues ?? []).filter((entry) => entry.projectIds.includes(project.id) && entry.status === "ISSUED");

  function changeReadiness(readiness: "READY" | "IN_PROGRESS" | "ACCOUNTING") {
    return run(
      () => api(`/api/projects/${project.id}/readiness`, { method: "PATCH", body: { readiness } }),
      readiness === "ACCOUNTING" ? undefined : { key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done" },
    );
  }

  const columns: WorkspaceKey[] = hasCost ? ["quantity", "price", "subtotal", "cost", "margin"] : ["quantity", "price", "subtotal"];
  const formatAmount = (amount: number | null) => amount == null ? "—" : moneyExact(amount);

  function timelineEntries(label: WorkspaceKey, events: { date: string | null; actor: string | null }[], recorded = events.length > 0) {
    const values = new Set(events.map(({ date, actor }) => [date?.slice(0, 10), actor].filter(Boolean).join(" · ")).filter(Boolean));
    return <li data-recorded={recorded}>
      <strong>{t(label)}</strong>
      <span className="sr-only">{t(recorded ? "stageDone" : "stagePending")}</span>
      <div>{[...values].map((value) => <small key={value}>{value}</small>)}</div>
    </li>;
  }

  return (
    <article className="bw-project-detail" aria-labelledby="billing-detail-title" data-testid="billing-project-detail">
      <header className="bw-card bw-detail-header">
        <div className="bw-detail-top" data-layout-group>
          <Link className="bw-control" href={closeHref}>← {t("projectClose")}</Link>
          <div className="bw-actions" data-layout-group>
            {canEdit && <Button variant="secondary" onClick={() => setEditing(true)} data-testid="v2-modal-edit">{common("v2.edit")}</Button>}
            {preparation && ready && <Button variant="secondary" onClick={() => void changeReadiness("IN_PROGRESS")} disabled={busy}>{common("v2.moveInProgress")}</Button>}
            {preparation && (ready
              ? <Button variant="primary" onClick={() => setHandoff(true)} disabled={busy} data-testid="v2-detail-mark-billed">{v5("design.sendAccounting")}</Button>
              : <Button variant="primary" onClick={() => void changeReadiness("READY")} disabled={busy || !pending?.items.length || pending.pricePendingCount > 0} data-testid="v2-mark-ready">{common("v2.markReady")}</Button>)}
            {canIssue && <Button variant={canPay ? "secondary" : "primary"} onClick={() => setIssuing(true)}>{t("newInvoice")}</Button>}
            {canPay && invoiceToPay && <Link className="bw-control bw-primary" href={`${BILLING}/tax-invoices/${invoiceToPay.id}#invoice-payments`}>{t("recordPayment")}</Link>}
          </div>
        </div>
        <div className="bw-detail-title" data-layout-group>
          <div>
            <h1 id="billing-detail-title">{project.name}</h1>
            {view.client && <Link className="bw-text-link" href={`${BILLING}/customers/${encodeURIComponent(project.clientId)}`}>{view.client}</Link>}
          </div>
          <Amount usd={view.amount} khr={view.estimatedKhr} estimated />
        </div>
        <div className="bw-detail-meta">
          <ProjectStatusBadges view={view} />
          {view.kinds.map((kind) => <span key={kind} className="bw-badge">{t(kind)}</span>)}
          {view.archivedImport && <span className="bw-badge">{t("imported")}</span>}
          {project.date && <span className="bw-badge">{project.date}</span>}
        </div>
        {note && <p className="bw-note">{note}</p>}
      </header>

      <DetailSection title={t("lines")}>
        {!items.length ? <WorkspaceState /> : <table role="table" className="bw-lines" aria-label={t("lines")} data-cost={hasCost}>
          <thead role="rowgroup" className="bw-lines-head"><tr role="row">
            <th role="columnheader" scope="col">{t("item")}</th>
            {columns.map((column) => <th role="columnheader" key={column} scope="col" className="bw-line-number">{t(column)}</th>)}
            <th role="columnheader" scope="col"><span className="sr-only">{t("prices")}</span></th>
          </tr></thead>
          <tbody role="rowgroup">{items.map(({ item, kind, unit, price }) => {
            const values = [
              item.quantity.toLocaleString() + (unit ? ` ${unit}` : ""),
              formatAmount(price),
              formatAmount(item.amount),
              formatAmount(item.printCost ?? null),
              formatAmount(item.printCost == null || item.amount == null ? null : item.amount - item.printCost),
            ];
            const historyQuery = new URLSearchParams({ q: item.description });
            return <tr role="row" key={item.id} data-testid="billing-detail-line" data-layout-group>
              <th role="rowheader" scope="row" className="bw-line-title"><strong>{item.description}</strong><small>{t(kind)}</small></th>
              {columns.map((column, index) => <td role="cell" key={column} className="bw-line-number">
                <span className="bw-line-label" aria-hidden="true">{t(column)}</span>
                <span className="bw-line-value">{values[index]}</span>
              </td>)}
              <td role="cell" className="bw-line-history"><Link className="bw-text-link" href={`${BILLING}/price-history?${historyQuery}`}>{t("prices")}</Link></td>
            </tr>;
          })}</tbody>
        </table>}
      </DetailSection>
      <DetailSection title={t("timeline")}>
        <ol className="bw-timeline" data-layout-group>
          {timelineEntries("created", [{ date: project.createdAt || project.date, actor: project.createdBy }])}
          {timelineEntries("delivered", deliveries, view.workComplete || deliveries.length > 0)}
          {timelineEntries("billed", [...invoices.filter((entry) => !entry.cancelled), ...issueRecords.map((entry) => ({ date: entry.issuedAt, actor: entry.issuedBy }))])}
          {timelineEntries("paid", payments.filter((entry) => !entry.voided))}
        </ol>
      </DetailSection>
      <DetailSection title={t("invoices")}>
        {(invoices.length > 0 || !issueRecords.length) && <RecordRows invoices={invoices} />}
        {issueRecords.length > 0 && <ul className="bw-records">{issueRecords.map((entry) => <li key={entry.id}>
          <Link className="bw-text-link" href={`${BILLING}/accounting#no-invoice-records`}>{t("noInvoice")} · {entry.issuedAt.slice(0, 10)}</Link>
          <Amount usd={entry.amountUsd} />
        </li>)}</ul>}
      </DetailSection>
      {snapshot.scope.payment && <DetailSection title={t("payments")}><PaymentRows payments={payments} invoices={invoices} /></DetailSection>}
      <DetailSection title={t("compare")}>
        {!related.length ? <WorkspaceState /> : <ul className="bw-records">{related.map((entry) => (
          <li key={entry.project.id} data-layout-group>
            <div><Link href={projectHref(entry.project.id, query)} className="bw-text-link">{entry.project.name}</Link><small>{entry.project.date} · {entry.client}</small></div>
            <Amount usd={entry.amount} />
          </li>
        ))}</ul>}
      </DetailSection>

      {editing && pending && <ProjectModal
        project={pending} clientName={view.client} clients={selectableClients(snapshot.clients)}
        serviceTypes={snapshot.serviceTypes} depositLocked={items.some(({ item }) => isBilled(item))}
        accountingFlow initialEdit onClose={() => setEditing(false)}
      />}
      {issuing && canIssue && <InvoiceEditor mode="create" snapshot={snapshot} customerId={project.clientId}
        billingItemIds={eligibleBilling(snapshot).filter(({ item }) => item.projectId === project.id).map(({ item }) => item.id)}
        onClose={() => setIssuing(false)}
      />}
      <ConfirmDialog
        open={handoff} busy={busy} onClose={() => setHandoff(false)}
        onConfirm={async () => { if (await changeReadiness("ACCOUNTING")) setHandoff(false); }}
        title={v5("design.sendAccountingTitle")}
        message={v5("design.sendAccountingBody", { count: 1, total: moneyExact(pending?.total ?? 0) })}
        confirmLabel={v5("design.sendAccounting")} testId="v2-confirm-bill"
      />
    </article>
  );
}
