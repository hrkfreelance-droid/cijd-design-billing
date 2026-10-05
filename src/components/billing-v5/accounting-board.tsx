"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { Modal } from "@/components/billing-v2/modal";
import { Price, ProjectDetail } from "@/components/billing-v2/project-detail";
import { CheckIcon } from "@/components/icons";
import { api, useI18n, useToast } from "@/components/providers";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { toBoardProject } from "@/lib/billing-v2/board";
import { serviceForItem, serviceLabel } from "@/lib/billing-v2/services";
import { hasErrors, projectPaymentsWithLegacyDeposit, roundMoney, settlement, validatePayment } from "@/lib/billing-v5/calculation";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { billingState, eligibleBilling, invoiceCollection, type BillingState } from "@/lib/billing-v5/ontology";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { InvoiceEditor } from "./invoice-editor";

/**
 * Accounting is one screen: work handed off by Design, then the invoice list.
 * Status is shown on each row/invoice instead of splitting the workflow into tabs.
 */
export function AccountingBoard({ snapshot }: { snapshot: Snapshot }) {
  const t = useV5T();
  const eligible = useMemo(() => {
    const accountingIds = new Set(snapshot.projects.filter((project) => project.billingReadiness === "ACCOUNTING").map((project) => project.id));
    return eligibleBilling(snapshot).filter((state) => accountingIds.has(state.item.projectId) || state.allocations.length > 0);
  }, [snapshot]);
  const toInvoiceTotal = roundMoney(eligible.reduce((sum, state) => sum + state.remainingUsd, 0));
  const outstanding = roundMoney(
    (snapshot.taxInvoices ?? [])
      .filter((invoice) => invoice.status === "ISSUED" && !invoice.invoiceNumber.startsWith("TEST"))
      .reduce((sum, invoice) => sum + invoiceCollection(snapshot, invoice).outstandingUsd, 0),
  );

  return (
    <div className="pb-36" data-testid="v5-accounting">
      <header className="px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] sm:text-[30px]">{t("accounting.title")}</h1>
        <p className="mt-1 text-[13.5px] text-muted">{t("accounting.subtitle")}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-12">
          <Figure label={t("accounting.toInvoice")} strong testId="v5-to-invoice-total">{moneyExact(toInvoiceTotal)}</Figure>
          <Figure label={t("list.outstanding")} testId="v5-outstanding-total">{moneyExact(outstanding)}</Figure>
          <Figure label={t("accounting.rate")} testId="v5-rate">
            {snapshot.exchangeRate ? snapshot.exchangeRate.rate.toLocaleString("en-US") : t("accounting.rateNone")}
          </Figure>
        </dl>
      </header>

      <div className="px-5 sm:px-8">
        <ToInvoice snapshot={snapshot} eligible={eligible} />
        <section className="pt-12" data-testid="v5-section-invoices">
          <div className="border-b border-line-strong pb-2.5">
            <h2 className="text-[16px] font-semibold tracking-[-0.012em]">{t("accounting.openInvoices")}</h2>
          </div>
          <OpenInvoiceProjects snapshot={snapshot} />
        </section>
      </div>
    </div>
  );
}

function Figure({ label, children, strong = false, testId }: { label: string; children: ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className={`tnum mt-0.5 truncate leading-tight tracking-[-0.02em] ${strong ? "text-[22px] font-semibold" : "text-[17px] font-medium text-text/85"}`} data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------ open invoices */

function OpenInvoiceProjects({ snapshot }: { snapshot: Snapshot }) {
  const t = useV5T();

  const groups = useMemo(() => {
    const byClient = new Map<string, {
      clientName: string;
      rows: {
        invoice: NonNullable<Snapshot["taxInvoices"]>[number];
        projectName: string;
        paid: number;
        outstanding: number;
        status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
      }[];
    }>();

    for (const invoice of snapshot.taxInvoices ?? []) {
      if (invoice.status !== "ISSUED" || invoice.invoiceNumber.startsWith("TEST")) continue;
      const clientName = snapshot.clients.find((client) => client.id === invoice.clientId)?.name ?? invoice.customer.companyNameEn;
      if (/^TEST\b/i.test(clientName.trim())) continue;
      const money = invoiceCollection(snapshot, invoice);
      if (money.status === "PAID") continue;

      const names = [...new Set(
        invoice.lines
          .map((line) => line.projectName?.trim())
          .filter((name): name is string => !!name),
      )];
      const projectName = names.length
        ? names.join(" / ")
        : invoice.project.name?.trim() || invoice.invoiceNumber;

      const group = byClient.get(invoice.clientId) ?? { clientName, rows: [] };
      group.rows.push({
        invoice,
        projectName,
        paid: money.paidUsd,
        outstanding: money.outstandingUsd,
        status: money.status,
      });
      byClient.set(invoice.clientId, group);
    }

    return [...byClient.values()]
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) =>
          b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) ||
          b.invoice.invoiceNumber.localeCompare(a.invoice.invoiceNumber),
        ),
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [snapshot]);

  if (groups.length === 0) {
    return <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("accounting.issuedEmpty")}</p>;
  }

  return (
    <div data-testid="v5-open-invoice-projects">
      {groups.map((group) => (
        <div key={group.clientName} className="pt-3" data-testid="v5-issued-client-group">
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center border-b border-line-strong">
            <span aria-hidden />
            <h3 className="min-w-0 truncate py-2.5 text-[16px] font-semibold tracking-[-0.012em]">{group.clientName}</h3>
            <span className="tnum shrink-0 pl-4 text-[15px] font-semibold">
              {moneyExact(group.rows.reduce((sum, row) => sum + row.outstanding, 0))}
            </span>
          </div>
          <ul>
            {group.rows.map(({ invoice, projectName, paid, outstanding, status }) => (
              <li
                key={invoice.id}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] border-b border-line"
                data-testid="v5-issued-row"
              >
                <span className="flex h-11 w-11 items-start pt-[18px]" aria-hidden>
                  <span className={`h-2.5 w-2.5 rounded-full ${status === "PARTIALLY_PAID" ? "bg-pending" : "bg-line-strong"}`} />
                </span>
                <Link
                  href={`/office-v5/tax-invoices/${invoice.id}`}
                  aria-label={t("invoice.open", { number: invoice.invoiceNumber })}
                  className="group min-w-0 py-3.5 text-left"
                >
                  <span className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 truncate text-[15px] font-medium leading-snug tracking-[-0.01em] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                      {projectName}
                    </span>
                    <span className="tnum shrink-0 text-[15px] font-semibold">{moneyExact(invoice.totalUsd)}</span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    <span className="tnum">{invoice.invoiceNumber}</span>
                    {" · "}
                    <span className="tnum">{invoice.invoiceDate}</span>
                    {" · "}
                    <span data-testid="v5-row-status">{t(`status.${status}` as V5Key)}</span>
                  </span>
                  <span className="mt-1.5 block space-y-[3px]">
                    {invoice.lines.map((line, index) => (
                      <span
                        key={`${invoice.id}:${index}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[13px] leading-5"
                      >
                        <span className="min-w-0 truncate text-text/90">
                          {line.description}
                          {line.quantity !== 1 && <span className="tnum text-faint"> ×{line.quantity}</span>}
                        </span>
                        <span className="tnum text-right text-muted">{moneyExact(line.amount)}</span>
                      </span>
                    ))}
                  </span>
                  <span className="tnum mt-1.5 block text-[12.5px] text-muted">
                    {t("list.paid")} {moneyExact(paid)}
                    {" · "}
                    <span className="font-medium text-text" data-testid="v5-row-outstanding">
                      {t("list.outstanding")} {moneyExact(outstanding)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ to invoice */

interface ProjectGroup {
  projectId: string;
  lines: BillingState[];
  remaining: number;
}

function ToInvoice({ snapshot, eligible }: { snapshot: Snapshot; eligible: BillingState[] }) {
  const t = useV5T();
  const { toast } = useToast();
  const [selected, setSelected] = useState<{ customerId: string | null; projectIds: Set<string> }>({ customerId: null, projectIds: new Set() });
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ customerId: string; billingItemIds: string[] } | null>(null);

  const groups = useMemo(() => {
    const byClient = new Map<string, Map<string, ProjectGroup>>();
    for (const state of eligible) {
      const project = snapshot.projects.find((entry) => entry.id === state.item.projectId);
      if (!project) continue;
      const projects = byClient.get(project.clientId) ?? new Map<string, ProjectGroup>();
      const group = projects.get(project.id) ?? { projectId: project.id, lines: [], remaining: 0 };
      group.lines.push(state);
      group.remaining = roundMoney(group.remaining + state.remainingUsd);
      projects.set(project.id, group);
      byClient.set(project.clientId, projects);
    }
    return [...byClient.entries()]
      .map(([clientId, projects]) => ({ client: snapshot.clients.find((c) => c.id === clientId)!, projects: [...projects.values()] }))
      .filter((group) => group.client)
      .sort((a, b) => a.client.name.localeCompare(b.client.name));
  }, [eligible, snapshot]);

  const toggle = (clientId: string, projectId: string) =>
    setSelected((current) => {
      if (current.customerId && current.customerId !== clientId) {
        const name = snapshot.clients.find((c) => c.id === clientId)?.name ?? "";
        toast(t("select.oneCustomer", { name }));
        return { customerId: clientId, projectIds: new Set([projectId]) };
      }
      const ids = new Set(current.projectIds);
      if (ids.has(projectId)) ids.delete(projectId);
      else ids.add(projectId);
      return { customerId: ids.size ? clientId : null, projectIds: ids };
    });

  const chosenLines = eligible.filter((state) => selected.projectIds.has(state.item.projectId));
  const chosenTotal = roundMoney(chosenLines.reduce((sum, state) => sum + state.remainingUsd, 0));
  const open = openProject ? groups.flatMap((g) => g.projects.map((p) => ({ group: g, project: p }))).find((entry) => entry.project.projectId === openProject) : undefined;

  return (
    <section className="pt-8" data-testid="v5-section-to-invoice">
      {groups.length === 0 ? (
        <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("accounting.toInvoiceEmpty")}</p>
      ) : (
        groups.map((group) => (
          <div key={group.client.id} className="pt-3" data-testid="v5-client-group">
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center border-b border-line-strong">
              <span aria-hidden />
              <h3 className="min-w-0 truncate py-2.5 text-[16px] font-semibold tracking-[-0.012em]">{group.client.name}</h3>
              <span className="tnum shrink-0 pl-4 text-[15px] font-semibold">{moneyExact(group.projects.reduce((sum, p) => sum + p.remaining, 0))}</span>
            </div>
            <ul>
              {group.projects.map((entry) => (
                <ProjectRow
                  key={entry.projectId}
                  snapshot={snapshot}
                  entry={entry}
                  checked={selected.projectIds.has(entry.projectId)}
                  onToggle={() => toggle(group.client.id, entry.projectId)}
                  onOpen={() => setOpenProject(entry.projectId)}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {selected.projectIds.size > 0 && (
        <div className="animate-rise fixed inset-x-0 bottom-0 z-40" data-testid="v5-selection-bar">
          <div className="safe-bottom-bar header-surface border-t border-line backdrop-blur-xl">
            <div className="mx-auto flex max-w-[960px] items-center gap-4 px-5 pt-3 sm:px-8">
              <button
                type="button"
                onClick={() => setSelected({ customerId: null, projectIds: new Set() })}
                aria-label={t("select.clear")}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill text-muted hover:text-text"
              >
                ×
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-muted">
                  {snapshot.clients.find((c) => c.id === selected.customerId)?.name} · {t("select.selected", { count: selected.projectIds.size })}
                </span>
                <span className="tnum block text-[18px] font-semibold leading-tight tracking-[-0.02em]" data-testid="v5-selected-total">{moneyExact(chosenTotal)}</span>
              </span>
              <Button
                variant="primary"
                onClick={() => setCreating({ customerId: selected.customerId!, billingItemIds: chosenLines.map((s) => s.item.id) })}
                data-testid="v5-create-invoice"
              >
                {t("select.create")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <ProjectSheet
          key={open.project.projectId}
          snapshot={snapshot}
          projectId={open.project.projectId}
          clientName={open.group.client.name}
          lines={open.project.lines}
          onClose={() => setOpenProject(null)}
          onCreate={() => {
            setOpenProject(null);
            setCreating({ customerId: open.group.client.id, billingItemIds: open.project.lines.map((s) => s.item.id) });
          }}
        />
      )}
      {creating && (
        <InvoiceEditor
          mode="create"
          snapshot={snapshot}
          customerId={creating.customerId}
          billingItemIds={creating.billingItemIds}
          onClose={() => setCreating(null)}
        />
      )}
    </section>
  );
}

function ProjectRow({ snapshot, entry, checked, onToggle, onOpen }: { snapshot: Snapshot; entry: ProjectGroup; checked: boolean; onToggle: () => void; onOpen: () => void }) {
  const t = useV5T();
  const { t: t3 } = useI18n();
  const project = snapshot.projects.find((p) => p.id === entry.projectId)!;
  return (
    <li className={`grid grid-cols-[2.75rem_minmax(0,1fr)] border-b border-line ${checked ? "bg-accent/[0.045]" : ""}`} data-project-id={project.id} data-testid="v5-accounting-row">
      <button type="button" role="checkbox" aria-checked={checked} aria-label={project.name} onClick={onToggle} className="group/check flex h-11 w-11 items-center self-start pt-[13px]" data-testid="v5-select-project">
        <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-[6px] border transition-colors ${checked ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-panel text-transparent group-hover/check:border-accent"}`}>
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      </button>
      <button type="button" onClick={onOpen} aria-label={t("accounting.open", { name: project.name })} className="group block min-w-0 py-3.5 text-left" data-testid="v5-open-project">
        <span className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 text-[15px] font-medium leading-snug tracking-[-0.01em] group-hover:underline group-hover:underline-offset-4">{project.name}</span>
          <span className="tnum shrink-0 text-[15px] font-semibold" data-testid="v5-row-total">{moneyExact(entry.remaining)}</span>
        </span>
        {(project.note ?? "").trim() && (
          <span className="mt-1 line-clamp-2 block whitespace-pre-line text-[13px] text-text/80" data-testid="v5-row-memo">
            <span className="text-muted">{t("accounting.memo")} · </span>
            {project.note}
          </span>
        )}
        <span className="mt-1.5 block space-y-[3px]">
          {entry.lines.map((state) => {
            const label = serviceLabel(serviceForItem(state.item, snapshot.serviceTypes), t3);
            const partial = state.state === "PARTIALLY_INVOICED";
            return (
              <span key={state.item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[13px] leading-5" data-testid="v5-line">
                <span className="min-w-0 truncate">
                  <span className="text-muted">{label}</span>
                  {state.item.description.trim() && state.item.description.trim().toLowerCase() !== label.toLowerCase() && <span className="text-text/90"> · {state.item.description.trim()}</span>}
                  <span className="tnum text-faint"> ×{state.item.quantity}</span>
                  {partial && <span className="text-pending"> · {t("billing.partial")} {moneyExact(state.invoicedUsd)} / {moneyExact(state.originalUsd)}</span>}
                </span>
                <Price value={state.remainingUsd} className="text-right text-muted" />
              </span>
            );
          })}
        </span>
      </button>
    </li>
  );
}

/** One project, opened from To invoice: memo first, then the lines and what each has left. */
function ProjectSheet({
  snapshot,
  projectId,
  clientName,
  lines,
  onClose,
  onCreate,
}: {
  snapshot: Snapshot;
  projectId: string;
  clientName: string;
  lines: BillingState[];
  onClose: () => void;
  onCreate: () => void;
}) {
  const t = useV5T();
  const { t: t3 } = useI18n();
  const { run, busy } = useAction();
  const project = snapshot.projects.find((p) => p.id === projectId)!;
  const allLines = snapshot.billingItems.filter((item) => item.projectId === projectId && !item.deletedAt);
  const board = toBoardProject(project, allLines, snapshot);
  const states = allLines.map((item) => billingState(snapshot, item));
  const partly = states.some((s) => s.allocations.length > 0);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      kicker={clientName}
      title={project.name}
      subtitle={<span>{t("accounting.lines", { count: lines.length })}</span>}
      closeLabel={t3("common.close")}
      testId="v5-accounting-modal"
      footer={
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[12.5px] text-muted">{t("prepare.finalNote")}</span>
          <Button variant="primary" onClick={onCreate} data-testid="v5-prepare">{t("select.create")}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {(project.note ?? "").trim() && (
          <div className="rounded-xl border border-line bg-fill px-4 py-3" data-testid="v5-memo">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{t("accounting.memo")}</p>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-text">{project.note}</p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:flex sm:flex-wrap sm:gap-x-10" data-testid="v5-details">
          <Detail label={t("accounting.details")} value={clientName} />
          <Detail label={t("accounting.date")} value={project.date} />
          <Detail label={t("accounting.lines", { count: board.items.length })} value={moneyExact(board.total)} />
        </dl>
      </div>
      <div className="mt-6">
        <ProjectDetail project={{ ...board, note: "" }} />
      </div>

      {partly && (
        <section className="mt-8 border-t border-line pt-4" data-testid="v5-billing-states">
          <h3 className="text-[13px] font-semibold">{t("view.invoices")}</h3>
          <ul className="mt-2">
            {states.map((state) => (
              <li key={state.item.id} className="grid grid-cols-[minmax(0,1fr)_repeat(3,6.5rem)] gap-x-3 border-b border-line py-2 text-[13px]" data-testid="v5-billing-state">
                <span className="min-w-0 truncate">
                  {state.item.description}
                  {state.invoiceIds.length > 0 && (
                    <span className="block text-[12px] text-faint">
                      {t("billing.linked")}: {state.invoiceIds.map((id) => snapshot.taxInvoices?.find((i) => i.id === id)?.invoiceNumber).join(", ")}
                    </span>
                  )}
                </span>
                <Amount label={t("billing.original")} value={state.originalUsd} />
                <Amount label={t("billing.invoiced")} value={state.invoicedUsd} />
                <Amount label={t("billing.remaining")} value={state.remainingUsd} strong />
              </li>
            ))}
          </ul>
        </section>
      )}

      <DepositsPanel projectId={projectId} snapshot={snapshot} run={run} total={board.total} />
    </Modal>
  );
}

function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className="tnum text-right">
      <span className="block text-[11px] text-faint">{label}</span>
      <span className={strong ? "font-semibold" : "text-muted"}>{moneyExact(value)}</span>
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="tnum truncate font-medium">{value}</dd>
    </div>
  );
}

/**
 * Deposits received on the project before it is invoiced. They are offered as
 * the invoice's deposit when it is created; payments against an invoice are
 * recorded on the invoice itself.
 */
function DepositsPanel({ projectId, snapshot, run, total }: { projectId: string; snapshot: Snapshot; run: ReturnType<typeof useAction>["run"]; total: number }) {
  const t = useV5T();
  const { toast } = useToast();
  const project = snapshot.projects.find((p) => p.id === projectId)!;
  const payments = projectPaymentsWithLegacyDeposit({ id: projectId, depositAmount: project.depositAmount ?? null, date: project.date }, snapshot.projectPayments ?? []);
  const result = settlement(total, payments);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(phnomPenhDate());
  const value = Number(amount);
  const issues = amount.trim() ? validatePayment(value, result.balance) : [];

  const add = async () => {
    const ok = await run(() => api("/api/v5/payments", { method: "POST", body: { projectId, kind: "DEPOSIT", amount: value, paidOn } }));
    if (ok) {
      setAmount("");
      toast(t("payments.added"));
    }
  };
  const remove = async (id: string) => {
    const ok = await run(() => api(`/api/v5/payments/${id}`, { method: "DELETE" }));
    if (ok) toast(t("payments.removed"));
  };

  return (
    <section className="mt-8 border-t border-line pt-4" data-testid="v5-payments">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">{t("editor.deposit")}</h3>
        <span className="text-[12px] text-faint">{t("balance.basis")}</span>
      </div>
      {payments.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{t("payments.none")}</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {payments.map((payment) => {
            const legacy = "legacy" in payment;
            const voided = !!payment.voidedAt;
            return (
              <li key={payment.id} className={`flex items-baseline gap-3 border-b border-line py-2 text-[13px] ${voided ? "text-faint line-through" : ""}`} data-testid="v5-payment">
                <span className="tnum w-24 shrink-0 text-muted">{"paidOn" in payment ? payment.paidOn : ""}</span>
                <span className="min-w-0 flex-1 truncate">{legacy ? t("payments.legacy") : t(`payments.kind.${payment.kind}` as V5Key)}</span>
                <span className="tnum shrink-0 font-medium">{moneyExact(payment.amount)}</span>
                {!legacy && !voided && (
                  <button type="button" onClick={() => void remove(payment.id)} className="shrink-0 text-[12.5px] text-muted hover:text-danger">{t("payments.remove")}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[8rem_10rem_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("payments.amount")}</span>
          <Input inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => setAmount(event.target.value)} aria-invalid={hasErrors(issues) || undefined} className={`tnum text-right ${hasErrors(issues) ? "!border-danger" : ""}`} data-testid="v5-payment-amount" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("payments.date")}</span>
          <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} data-testid="v5-payment-date" />
        </label>
        <Button variant="secondary" onClick={() => void add()} disabled={!amount.trim() || hasErrors(issues)} className="col-span-2 sm:col-span-1 sm:justify-self-start" data-testid="v5-payment-add">
          {t("payments.add")}
        </Button>
      </div>
    </section>
  );
}
