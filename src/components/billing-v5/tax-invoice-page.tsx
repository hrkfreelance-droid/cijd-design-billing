"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { api, useData, useToast } from "@/components/providers";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { toCents } from "@/lib/billing-v5/calculation";
import { invoiceActionAvailability } from "@/lib/billing-v5/invoice-action-availability";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { invoiceCollection, LEDGER_PAYMENT_PREFIX } from "@/lib/billing-v5/ontology";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import type { Snapshot, TaxInvoiceRecord } from "@/lib/types";
import { FitA4 } from "./fit-a4";
import { InvoiceDocument } from "./invoice-document";
import { InvoiceActions } from "./invoice-actions";

/**
 * An invoice, reopened: the latest version as the document, and around it
 * (never printed) what happened to it — payments, the billings it carries and
 * its revision history. Print / Save PDF prints the A4 sheet and nothing else.
 */
export function TaxInvoicePage({ id }: { id: string }) {
  const t = useV5T();
  const { snapshot } = useData();
  const { run, busy } = useAction();
  const printRequested = useSearchParams().get("print") === "1";
  const printed = useRef(false);
  const printable = snapshot?.taxInvoices?.find((entry) => entry.id === id);

  useEffect(() => {
    if (!printRequested || !printable || printed.current) return;
    let stopped = false;
    void (async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(".v5-print-root img"))
        .map((image) => image.decode().catch(() => {})));
      // FitA4 measures the loaded fonts/logo before the browser takes its page.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!stopped) { printed.current = true; window.print(); }
    })();
    return () => { stopped = true; };
  }, [printRequested, printable]);

  if (!snapshot) return <p className="px-5 pt-24 text-center text-[14px] text-muted">…</p>;
  const invoice = (snapshot.taxInvoices ?? []).find((entry) => entry.id === id);
  const clientName = invoice ? (snapshot.clients.find((client) => client.id === invoice.clientId)?.name ?? "") : "";
  const money = invoice ? invoiceCollection(snapshot, invoice) : null;
  const statusKey = invoice?.status === "CANCELLED" ? "status.CANCELLED" : `status.${money?.status ?? "UNPAID"}`;
  const collected = invoice?.status === "ISSUED" && money?.status === "PAID";
  const invoiceKind = invoice?.invoiceKind ?? "FULL";
  const { depositLocked, laterDeposit } = invoice ? invoiceActionAvailability(snapshot, invoice) : { depositLocked: false, laterDeposit: false };

  return (
    <div className="pb-16">
      <div className="v5-no-print header-surface border-b border-line">
        <div className="mx-auto flex min-h-[52px] max-w-[960px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2 sm:px-8" data-layout-group>
          <Link href={collected ? "/office-v5/tax-invoices?collection=paid" : "/office-v5/tax-invoices"} className="text-[13.5px] font-medium text-accent hover:underline" data-testid="v5-invoice-back">
            ← {collected ? t("invoice.backPaid") : t("invoice.back")}
          </Link>
          {invoice && (
            <span className="min-w-0 flex-1 basis-48 break-words text-[13px] text-muted">
              <span className="tnum font-semibold text-text" data-testid="v5-invoice-heading">{invoice.invoiceNumber}</span>
              {" · "}
              <span className={invoice.status === "CANCELLED" ? "text-danger" : ""} data-testid="v5-invoice-status">{t(statusKey as V5Key)}</span>
              {" · "}<span data-testid="v5-invoice-kind">{t(`list.kind.${invoiceKind}` as V5Key)}</span>
              {" · "}
              {clientName} · <span className="tnum">{moneyExact(invoice.totalUsd)}</span>
            </span>
          )}
          {invoice && (
            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2" data-layout-group>
              <InvoiceActions invoice={invoice} snapshot={snapshot} />
            </div>
          )}
        </div>
      </div>

      {!invoice || !money ? (
        <p className="px-5 pt-24 text-center text-[14px] text-muted" data-testid="v5-invoice-missing">{t("invoice.notFound")}</p>
      ) : (
        <>
          <p className="v5-no-print mx-auto max-w-[210mm] px-5 pt-4 text-[12px] text-faint sm:px-0">
            {t("invoice.issuedOn", { date: phnomPenhDate(new Date(invoice.issuedAt)), name: invoice.issuedBy })}
            {(invoice.revision ?? 1) > 1 && ` · ${t("detail.revision", { n: invoice.revision ?? 1 })}`}
            {invoice.cancellationReason ? ` · ${invoice.cancellationReason}` : ""}
          </p>
          {(depositLocked || laterDeposit) && (
            <p className="v5-no-print mx-auto max-w-[210mm] px-5 pt-2 text-[12px] text-pending sm:px-0">
              {t(depositLocked ? "detail.depositLocked" : "detail.depositSequenceLocked")}
            </p>
          )}
          <div className="mx-auto mt-3 max-w-[210mm] px-3 sm:px-0">
            <div className="v5-print-root">
              <FitA4>
                <InvoiceDocument invoice={invoice} />
              </FitA4>
            </div>
          </div>
          <div className="v5-no-print mx-auto mt-10 max-w-[210mm] space-y-10 px-5 sm:px-0">
            <Payments invoice={invoice} snapshot={snapshot} money={money} run={run} busy={busy} />
            <Billings invoice={invoice} snapshot={snapshot} />
            <History invoice={invoice} snapshot={snapshot} />
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, testId, children, aside, id }: { title: string; testId: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section id={id} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Payments({
  invoice,
  snapshot,
  money,
  run,
  busy,
}: {
  invoice: TaxInvoiceRecord;
  snapshot: Snapshot;
  money: ReturnType<typeof invoiceCollection>;
  run: ReturnType<typeof useAction>["run"];
  busy: boolean;
}) {
  const t = useV5T();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(phnomPenhDate());
  const [note, setNote] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const value = Number(amount);
  const tooMuch = amount.trim() !== "" && toCents(value) > toCents(money.outstandingUsd);
  const validAmount = amount.trim() !== "" && Number.isFinite(value) && value > 0 && !tooMuch;
  void snapshot;

  const add = async () => {
    const ok = await run(() => api(`/api/v5/tax-invoices/${invoice.id}/payments`, { method: "POST", body: { amount: value, paidOn, note } }));
    if (ok) {
      setAmount("");
      setNote("");
      toast(t("detail.paymentAdded"));
    }
  };
  const voidPayment = async () => {
    const ok = await run(() => api(`/api/v5/invoice-payments/${voiding}/void`, { method: "POST", body: { reason: voidReason } }));
    setVoiding(null);
    setVoidReason("");
    if (ok) toast(t("detail.paymentVoided"));
  };

  return (
    <Panel
      id="invoice-payments"
      title={t("detail.payments")}
      testId="v5-invoice-payments"
      aside={
        <span className="tnum text-[13px] text-muted" data-testid="v5-collection">
          {t("list.paid")} {moneyExact(money.paidUsd)} · <span className="font-semibold text-text" data-testid="v5-outstanding">{t("list.outstanding")} {moneyExact(money.outstandingUsd)}</span>
        </span>
      }
    >
      {money.payments.length === 0 ? (
        <p className="py-4 text-[13px] text-muted">{t("payments.none")}</p>
      ) : (
        <ul>
          {money.payments.map((payment) => (
            <li key={payment.id} className={`grid grid-cols-[6.5rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-b border-line py-2.5 text-[13px] ${payment.voidedAt ? "text-faint" : ""}`} data-testid="v5-invoice-payment">
              <span className="tnum text-muted">{payment.paidOn}</span>
              <span className="min-w-0 truncate">
                {t(payment.kind === "DEPOSIT" ? "detail.deposit" : payment.id.startsWith(LEDGER_PAYMENT_PREFIX) ? "detail.ledgerPaid" : "detail.payment")}
                {payment.note && payment.note !== "Deposit" && <span className="text-muted"> · {payment.note}</span>}
                {payment.voidedAt && <span className="block text-[12px]">{t("detail.voided")}: {payment.voidReason}</span>}
              </span>
              <span className={`tnum font-medium ${payment.voidedAt ? "line-through" : ""}`}>{moneyExact(payment.amount)}</span>
              {!payment.voidedAt && payment.kind === "PAYMENT" && !payment.id.startsWith(LEDGER_PAYMENT_PREFIX) && invoice.status === "ISSUED" ? (
                <button type="button" onClick={() => setVoiding(payment.id)} className="text-[12.5px] text-muted hover:text-danger" data-testid="v5-payment-void">{t("detail.void")}</button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
      {invoice.status === "ISSUED" && money.outstandingUsd > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[8rem_10rem_minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">{t("detail.paymentAmount")}</span>
            <Input inputMode="decimal" value={amount} placeholder={money.outstandingUsd.toFixed(2)} onChange={(event) => setAmount(event.target.value)} aria-invalid={tooMuch || undefined} className={`tnum text-right ${tooMuch ? "!border-danger" : ""}`} data-testid="v5-invoice-payment-amount" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">{t("detail.paymentDate")}</span>
            <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} data-testid="v5-invoice-payment-date" />
          </label>
          <label className="col-span-2 block sm:col-span-1">
            <span className="mb-1 block text-[12px] font-medium text-muted">{t("detail.paymentNote")}</span>
            <Input value={note} onChange={(event) => setNote(event.target.value)} data-testid="v5-invoice-payment-note" />
          </label>
          <Button variant="secondary" onClick={() => void add()} disabled={!validAmount || busy} className="col-span-2 sm:col-span-1" data-testid="v5-invoice-payment-add">
            {t("detail.addPayment")}
          </Button>
          {tooMuch && <p className="col-span-2 text-[12.5px] text-danger sm:col-span-4">{t("payments.exceeds")}</p>}
        </div>
      )}
      <ConfirmDialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        onConfirm={() => void voidPayment()}
        busy={busy || !voidReason.trim()}
        tone="destructive"
        title={t("detail.void")}
        message={
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">{t("detail.voidReason")}</span>
            <Input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} data-testid="v5-void-reason" />
          </label>
        }
        confirmLabel={t("detail.void")}
        testId="v5-confirm-void"
      />
    </Panel>
  );
}

function Billings({ invoice, snapshot }: { invoice: TaxInvoiceRecord; snapshot: Snapshot }) {
  const t = useV5T();
  const allocations = (snapshot.billingAllocations ?? []).filter((a) => a.invoiceId === invoice.id && !a.voidedAt);
  if (!allocations.length) return null;
  return (
    <Panel title={t("detail.billings")} testId="v5-invoice-billings">
      <ul>
        {allocations.map((allocation) => {
          const item = snapshot.billingItems.find((i) => i.id === allocation.billingItemId);
          const project = item ? snapshot.projects.find((p) => p.id === item.projectId) : undefined;
          return (
            <li key={allocation.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-[13px]" data-testid="v5-invoice-billing">
              <span className="min-w-0 truncate">
                {item?.description ?? allocation.billingItemId}
                {project && <span className="text-muted"> · {project.name}</span>}
              </span>
              <span className="tnum shrink-0 text-muted">
                {moneyExact(allocation.amount)}
                {item?.amount != null && allocation.amount !== item.amount && <span className="text-faint"> / {moneyExact(item.amount)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function History({ invoice, snapshot }: { invoice: TaxInvoiceRecord; snapshot: Snapshot }) {
  const t = useV5T();
  const revisions = (snapshot.invoiceRevisions ?? []).filter((r) => r.invoiceId === invoice.id).sort((a, b) => b.revision - a.revision);
  return (
    <Panel title={t("detail.history")} testId="v5-invoice-history">
      <ul>
        {revisions.map((revision) => (
          <li key={revision.id} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 border-b border-line py-2.5 text-[13px]" data-testid="v5-revision">
            <span className="text-muted">
              {t("detail.revision", { n: revision.revision })}
              <span className="block text-[12px] text-faint">{t(`detail.action.${revision.action}` as V5Key)}</span>
            </span>
            <span className="min-w-0">
              <span className="tnum text-muted">{revision.changedAt.slice(0, 16).replace("T", " ")} · {revision.changedBy}</span>
              {revision.reason && <span className="block">{revision.reason}</span>}
              {revision.previousSnapshot && (
                <span className="tnum block text-[12px] text-faint">
                  {t("detail.before", { total: moneyExact(revision.previousSnapshot.totalUsd), lines: revision.previousSnapshot.lines.length })}
                  {revision.previousSnapshot.invoiceDate !== invoice.invoiceDate && ` · ${revision.previousSnapshot.invoiceDate}`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
