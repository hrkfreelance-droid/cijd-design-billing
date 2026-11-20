"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { useData, useI18n } from "@/components/providers";
import { moneyExact } from "@/lib/format";
import { useWorkspaceT } from "@/lib/billing-v5/workspace-i18n";
import type { ProjectInvoice, ProjectView } from "@/lib/billing-v5/project-view";

export const BILLING = "/office-v5";

export function projectHref(id: string, query = "") {
  return `${BILLING}/projects/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

export function WorkspaceHeading({ title, actions }: { title: string; actions?: ReactNode }) {
  return <header className="bw-heading" data-layout-group><h1>{title}</h1>{actions && <div className="bw-actions" data-layout-group>{actions}</div>}</header>;
}

export function WorkspaceState({ mode = "empty", children }: { mode?: "empty" | "loading" | "error"; children?: ReactNode }) {
  const t = useWorkspaceT();
  const { t: common } = useI18n();
  const { refresh } = useData();
  return (
    <div className="bw-state" role={mode === "error" ? "alert" : "status"} aria-busy={mode === "loading" || undefined}>
      <div>{children ?? t(mode)}</div>
      {mode === "error" && <Button variant="secondary" onClick={() => void refresh()}>{common("common.retry")}</Button>}
    </div>
  );
}

export function Amount({ usd, khr, estimated }: { usd: number | null; khr?: number | null; estimated?: boolean }) {
  const t = useWorkspaceT();
  return <span className="bw-money">
    <span>{usd == null ? "—" : moneyExact(usd)}</span>
    {khr != null && <small>{estimated && `${t("estimate")} `}{new Intl.NumberFormat("en-US").format(khr)} ៛</small>}
  </span>;
}

export function ProjectStatusBadges({ view }: { view: ProjectView }) {
  const t = useWorkspaceT();
  const workStatus = view.draft ? "draft"
    : view.status === "completed" && !view.workComplete && view.invoices.some((invoice) => !invoice.cancelled)
      ? "billed" : view.status;
  return <span className="bw-project-badges" data-layout-group>
    <span className="bw-badge" data-status={workStatus}>{t(workStatus)}</span>
    {view.collection && <span className="bw-badge" data-status={view.collection}>{t(view.collection)}</span>}
  </span>;
}

export function InvoiceLink({ entry }: { entry: ProjectInvoice }) {
  const t = useWorkspaceT();
  const label = entry.number ?? t("unknownInvoice");
  return entry.tax
    ? <Link href={`${BILLING}/tax-invoices/${entry.id}`} className="bw-text-link">{label}</Link>
    : <span>{label}</span>;
}
