"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useData, useSession } from "@/components/providers";
import { Button } from "@/components/ui";
import { canAny } from "@/lib/auth/roles";
import { useV5T } from "@/lib/billing-v5/i18n";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { priceHistory, pricingCustomerIds, taxInvoiceView, type ProjectPaymentView } from "@/lib/billing-v5/project-view";
import { useWorkspaceT } from "@/lib/billing-v5/workspace-i18n";
import type { Snapshot } from "@/lib/types";
import { AccountingBoard } from "./accounting-board";
import { InvoiceEditor } from "./invoice-editor";
import { InvoiceList } from "./invoice-list";
import { CustomerMaster, ProductMaster } from "./masters";
import { PriceRows } from "./price-history";
import { DetailSection, PaymentRows, RecordRows } from "./project-view-detail";
import { ProjectRows } from "./projects-workspace";
import { usePricingCustomerCandidates, useProjectViews } from "./workspace-shell";
import { BILLING, WorkspaceHeading, WorkspaceState } from "./workspace-parts";

function InvoiceArea({ snapshot, collection }: { snapshot: Snapshot; collection?: string | null }) {
  const t = useWorkspaceT();
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <WorkspaceHeading title={t("invoices")} actions={
        <>
          {collection && <Link className="bw-control" href={`${BILLING}/tax-invoices`}>{t("all")}</Link>}
          {user && canAny(user.role, ["invoice:write", "payment:write"]) &&
            <Button variant="primary" data-testid="v5-invoice-new" onClick={() => setCreating(true)}>+ {t("newInvoice")}</Button>}
        </>
      } />
      {collection === "overdue" && <h2 className="bw-section-title">{t("overdue")}</h2>}
      <InvoiceList snapshot={snapshot} collectionFilter={collection} />
      {creating && <InvoiceEditor mode="create" snapshot={snapshot} customerId={null} billingItemIds={[]} onClose={() => setCreating(false)} />}
    </>
  );
}

export function InvoicesPage() {
  const { snapshot } = useData();
  const params = useSearchParams();
  if (!snapshot) return null;
  return <div className="bw-page" data-testid="billing-invoices"><InvoiceArea key={params.get("collection")} snapshot={snapshot} collection={params.get("collection")} /></div>;
}

const accountingViews = ["to-invoice", "invoices", "customers", "products"] as const;
const accountingLabels = ["view.toInvoice", "view.invoices", "view.customers", "view.products"] as const;

export function AccountingPage() {
  const t = useV5T();
  const { snapshot } = useData();
  const search = useSearchParams();
  const view = accountingViews.find((option) => search.get("view") === option) ?? "to-invoice";
  if (!snapshot) return null;
  return <div className="bw-page bw-legacy-view">
    <WorkspaceHeading title={t("accounting.title")} />
    <nav aria-label={t("accounting.title")} className="bw-tabs bw-filter-panel" role="tablist" data-layout-group>
      {accountingViews.map((key, index) => (
        <Link key={key} href={`${BILLING}/accounting${key === "to-invoice" ? "" : `?view=${key}`}`} role="tab" aria-selected={view === key}>
          {t(accountingLabels[index])}
        </Link>
      ))}
    </nav>
    {view === "invoices" ? <InvoiceArea snapshot={snapshot} /> : view === "customers"
      ? <CustomerMaster snapshot={snapshot} />
      : view === "products" ? <ProductMaster snapshot={snapshot} />
      : <AccountingBoard snapshot={snapshot} embedded />}
  </div>;
}

export function CustomersPage() {
  const t = useWorkspaceT();
  const { snapshot } = useData();
  const projects = useProjectViews();
  const candidates = usePricingCustomerCandidates();
  const params = useSearchParams();
  const router = useRouter();
  if (!snapshot) return null;
  const clientIds = new Set(snapshot.clients.map((client) => client.id));
  const historicalClients = [...new Map(projects.filter((view) => !clientIds.has(view.project.clientId) && view.client)
    .map((view) => [view.project.clientId, view.client]))];
  return <div className="bw-page" data-testid="v5-customers-page">
    <WorkspaceHeading title={t("customers")} />
    {candidates.length > 0 && <details className="bw-card bw-customer-candidates">
      <summary>{t("mergeCandidates")}</summary>
      <p>{t("mergeCandidateHelp")}</p>
      <ul>{candidates.map((group) => <li key={group[0].id}>
        {group.map((client) => <Link key={client.id} className="bw-text-link" href={`${BILLING}/customers/${encodeURIComponent(client.id)}`}>{client.name}</Link>)}
      </li>)}</ul>
    </details>}
    <CustomerMaster key={params.get("edit")} snapshot={snapshot} activityLinks legacyClients={historicalClients}
      initialEdit={snapshot.clients.find((client) => client.id === params.get("edit"))?.id}
      onCloseEditor={params.has("edit") ? () => router.replace(`${BILLING}/customers`) : undefined}
    />
  </div>;
}

export function CustomerActivity({ id }: { id: string }) {
  const t = useWorkspaceT();
  const { snapshot } = useData();
  const projects = useProjectViews();
  const candidates = usePricingCustomerCandidates();
  if (!snapshot) return null;
  const own = projects.filter((entry) => entry.project.clientId === id)
    .sort((a, b) => b.project.date.localeCompare(a.project.date));
  const client = snapshot.clients.find((entry) => entry.id === id);
  const name = client?.name ?? own[0]?.client;
  if (!name) return <div className="bw-page"><WorkspaceHeading title={t("customers")} /><WorkspaceState>{t("customerMissing")}</WorkspaceState></div>;

  const tax = (snapshot.taxInvoices ?? []).filter((invoice) => invoice.clientId === id);
  const invoices = [...new Map([...own.flatMap((entry) => entry.invoices), ...tax.map((invoice) => taxInvoiceView(snapshot, invoice))]
    .map((entry) => [entry.id, entry])).values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const payments: ProjectPaymentView[] = own.flatMap((entry) => entry.payments);
  const covered = new Set(payments.map((entry) => entry.invoiceId));
  for (const invoice of tax.filter((entry) => !covered.has(entry.id))) {
    for (const entry of invoiceCollection(snapshot, invoice).payments) payments.push({
      id: entry.id, amount: entry.amount, date: entry.paidOn, actor: entry.createdBy, invoiceId: invoice.id,
      voided: Boolean(entry.voidedAt), deposit: entry.kind === "DEPOSIT",
    });
  }
  const uniquePayments = [...new Map(payments.map((entry) => [entry.id, entry])).values()]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const pricingIds = pricingCustomerIds(id, candidates);
  const history = priceHistory(projects.filter((entry) => pricingIds.has(entry.project.clientId)));

  return <div className="bw-page bw-customer-detail" data-testid="billing-customer-detail">
    <WorkspaceHeading title={name} actions={
      <>
        <Link className="bw-control" href={`${BILLING}/customers`}>← {t("customers")}</Link>
        {client && <Link className="bw-control" href={`${BILLING}/customers?edit=${encodeURIComponent(id)}`}>{t("manageCustomers")}</Link>}
      </>
    } />
    <DetailSection title={t("projects")}>
      <ProjectRows rows={own.filter((entry) => !entry.draft)} query={new URLSearchParams({ client: id }).toString()} />
    </DetailSection>
    <DetailSection title={t("invoices")}><RecordRows invoices={invoices} /></DetailSection>
    {snapshot.scope.payment && <DetailSection title={t("payments")}><PaymentRows payments={uniquePayments} invoices={invoices} /></DetailSection>}
    <DetailSection title={t("prices")}>
      <PriceRows rows={history.slice(0, 10)} />
      {history.length > 0 && <Link className="bw-control" href={`${BILLING}/price-history?client=${encodeURIComponent(id)}`}>{t("prices")} →</Link>}
    </DetailSection>
  </div>;
}
