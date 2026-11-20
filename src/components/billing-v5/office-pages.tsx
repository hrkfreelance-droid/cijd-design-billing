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

export function AccountingPage() {
  const t = useV5T();
  const { snapshot } = useData();
  const search = useSearchParams();
  const view = search.get("view");
  if (!snapshot) return null;
  if (view === "customers") return <CustomersPage />;
  if (view === "invoices") return <InvoicesPage />;
  const accounting = `${BILLING}/accounting`;
  const invoices = <Link className="bw-control" href={`${accounting}?view=invoices`}>{t("view.invoices")}</Link>;
  if (view === "products") return <div className="bw-page">
    <WorkspaceHeading title={t("view.products")} actions={<div className="bw-actions" data-layout-group>
      <Link className="bw-control" href={accounting}>{t("view.toInvoice")}</Link>
      {invoices}
    </div>} />
    <ProductMaster snapshot={snapshot} />
  </div>;
  return <AccountingBoard snapshot={snapshot} actions={<div className="bw-actions" data-layout-group>
    {invoices}
    <Link className="bw-control" href={`${accounting}?view=products`}>{t("view.products")}</Link>
  </div>} />;
}

export function CustomersPage() {
  const t = useV5T();
  const { snapshot } = useData();
  const params = useSearchParams();
  const router = useRouter();
  if (!snapshot) return null;
  return <div className="px-5 pb-32 pt-6 sm:px-8 sm:pt-8" data-testid="v5-customers-page">
    <header>
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] sm:text-[30px]">{t("nav.customers")}</h1>
      <p className="mt-1 text-[13.5px] text-muted">{t("customers.subtitle")}</p>
    </header>
    <CustomerMaster key={params.get("edit")} snapshot={snapshot}
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
