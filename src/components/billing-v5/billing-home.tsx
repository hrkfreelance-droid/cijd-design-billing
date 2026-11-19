"use client";

import Link from "next/link";
import { useData, useI18n, useSession } from "@/components/providers";
import { ChevronRight } from "@/components/icons";
import { can } from "@/lib/auth/roles";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { taxInvoiceView } from "@/lib/billing-v5/project-view";
import { useWorkspaceT, type WorkspaceKey } from "@/lib/billing-v5/workspace-i18n";
import { PaymentRows } from "./project-view-detail";
import { useProjectViews } from "./workspace-shell";
import { Amount, BILLING, WorkspaceHeading } from "./workspace-parts";

export function BillingHome() {
  const t = useWorkspaceT();
  const { t: common } = useI18n();
  const { snapshot } = useData();
  const { user } = useSession();
  const projects = useProjectViews();
  if (!snapshot) return null;
  const today = phnomPenhDate();
  const invoices = (snapshot.taxInvoices ?? []).filter((entry) => !entry.invoiceNumber.startsWith("TEST-"));
  const invoiceViews = invoices.map((invoice) => taxInvoiceView(snapshot, invoice));
  const unpaid = invoiceViews.filter((entry) => !entry.cancelled && entry.outstanding > 0);
  const overdue = unpaid.filter((entry) => entry.due && entry.due < today);
  const payments = projects.flatMap((project) => project.payments);
  for (const invoice of invoices.filter((entry) => !entry.projectId && !entry.projectIds?.length)) {
    for (const entry of invoiceCollection(snapshot, invoice).payments) payments.push({
      id: entry.id, date: entry.paidOn, actor: entry.createdBy, amount: entry.amount, voided: Boolean(entry.voidedAt),
      deposit: entry.kind === "DEPOSIT", invoiceId: invoice.id,
    });
  }
  const recent = [...new Map(payments.filter((entry) => entry.date && !entry.voided).map((entry) => [entry.id, entry])).values()]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);
  const metrics: { label: WorkspaceKey; count: number; href: string; amount?: number; hint?: WorkspaceKey; tone: string }[] = [
    { label: "ready", count: projects.filter((entry) => entry.canIssue || entry.status === "ready").length, href: "/projects?status=ready", tone: "ready" },
    { label: "progress", count: projects.filter((entry) => entry.status === "progress").length, href: "/projects?status=progress", tone: "progress" },
    { label: "unpaid", count: unpaid.length, amount: unpaid.reduce((sum, entry) => sum + entry.outstanding, 0), href: "/tax-invoices?collection=open", tone: "unpaid" },
    { label: "overdue", count: overdue.length, href: "/tax-invoices?collection=overdue", hint: unpaid.length && unpaid.every((entry) => !entry.due) ? "noDue" : undefined, tone: "overdue" },
  ];

  return <div className="bw-page" data-testid="billing-home">
    <WorkspaceHeading title={t("home")} />
    <section>
      <h2 className="bw-section-title">{t("today")}</h2>
      <div className="bw-metrics" data-layout-group>
        {metrics.map(({ label, count, href, amount, hint, tone }) => (
          <Link className="bw-card bw-metric" data-tone={tone} key={label} href={BILLING + href}>
            <span>{t(label)} <ChevronRight /></span>
            <strong>{count}</strong>
            {amount != null && <Amount usd={amount} />}
            {hint && <small>{t(hint)}</small>}
          </Link>
        ))}
      </div>
    </section>
    <div className="bw-home-panels" data-layout-group>
      {snapshot.scope.payment && <section className="bw-card">
        <div className="bw-section-heading" data-layout-group><h2>{t("recent")}</h2>
          <Link className="bw-text-link" href={`${BILLING}/accounting`}>{t("accounting")} →</Link>
        </div>
        <PaymentRows payments={recent} invoices={invoiceViews} />
      </section>}
      <section className="bw-card">
        <div className="bw-section-heading" data-layout-group><h2>{t("projects")}</h2>
          {user && can(user.role, "production:write") &&
            <Link className="bw-text-link" href={`${BILLING}/projects?new=1`}>+ {common("v2.newProject")}</Link>}
        </div>
        <ul className="bw-home-links">{(["design", "print", "archive", "prices"] as const).map((key) => (
          <li key={key}><Link href={BILLING + (key === "archive" ? "/projects?status=completed" : key === "prices" ? "/price-history" : `/projects?kind=${key}`)}>
            {t(key)}<ChevronRight />
          </Link></li>
        ))}</ul>
      </section>
    </div>
  </div>;
}
