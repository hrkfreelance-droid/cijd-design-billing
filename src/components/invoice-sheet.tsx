"use client";

import { useState } from "react";

import { api, useI18n, useSession } from "@/components/providers";
import { useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { CurrencyAmount } from "@/components/currency-amount";
import { Amount, Button, ConfirmSheet, Field, Input, Sheet } from "@/components/ui";
import { mediumDate, money, todayIso } from "@/lib/format";
import { can } from "@/lib/auth/roles";
import { discountLabel } from "@/lib/billing-pricing";
import { downloadInvoicePdf, openInvoicePdf, type InvoicePdfInput } from "@/lib/invoice-pdf";
import type { BillingDiscountType, Invoice, PltFormat } from "@/lib/types";

/** One invoice, one place. Billing and Archive both open this. */
export function InvoiceSheet({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const scope = useScope();
  const { run, busy } = useAction();
  const [paying, setPaying] = useState(false);
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [slip, setSlip] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  if (!invoice || !scope) return null;

  const client = scope.idx.clientById.get(invoice.clientId);
  const items = scope.idx.itemsByInvoice.get(invoice.id) ?? [];
  const canInvoice = !!user && can(user.role, "invoice:write");
  const canPay = !!user && can(user.role, "payment:write");
  const pdfInput: InvoicePdfInput = {
    invoice,
    clientName: client?.name,
    items,
    projectNames: new Map(items.map((item) => [item.projectId, scope.idx.projectById.get(item.projectId)?.name ?? ""])),
    locale,
  };

  const confirmPayment = async () => {
    const ok = await run(
      () => api(`/api/invoices/${invoice.id}/payment`, { method: "POST", body: { paymentDate, slip } }),
      { key: "toast.paymentConfirmed" },
    );
    if (ok) {
      setPaying(false);
      setSlip("");
      onClose();
    }
  };

  const cancelInvoice = async () => {
    const ok = await run(() => api(`/api/invoices/${invoice.id}`, { method: "DELETE" }), { key: "toast.invoiceCancelled" });
    setConfirmCancel(false);
    if (ok) onClose();
  };

  const undoPayment = async () => {
    const ok = await run(() => api(`/api/invoices/${invoice.id}/payment`, { method: "DELETE" }), { key: "toast.paymentReverted" });
    setConfirmUndo(false);
    if (ok) onClose();
  };

  const markReceiptSent = async () => {
    const ok = await run(
      () => api(`/api/invoices/${invoice.id}`, { method: "PATCH", body: { receiptStatus: "RECEIVED" } }),
      { key: "toast.receiptUpdated" },
    );
    if (ok) onClose();
  };

  return (
    <>
      <Sheet
        open={!paying}
        onClose={onClose}
        title={invoice.invoiceNumber ?? ""}
        description={client?.name}
        footer={
          <div className="space-y-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <Button variant="secondary" full onClick={() => openInvoicePdf(pdfInput)}>{t("billing.viewPdf")}</Button>
              <Button variant="secondary" full onClick={() => downloadInvoicePdf(pdfInput)}>{t("billing.downloadPdf")}</Button>
            </div>
            {invoice.status === "ISSUED" && canPay && (
              <Button variant="primary" full onClick={() => setPaying(true)}>{t("billing.confirmPayment")}</Button>
            )}
            {invoice.status === "PAID" && invoice.receiptStatus === "PENDING" && canPay && (
              <Button variant="primary" full onClick={markReceiptSent} disabled={busy}>{t("billing.receiptSent")}</Button>
            )}
            <Button variant="secondary" full onClick={onClose}>{t("common.close")}</Button>
            {invoice.status === "ISSUED" && canInvoice && (
              <button onClick={() => setConfirmCancel(true)} className="block w-full py-1.5 text-center text-[13px] text-faint transition-colors hover:text-review">
                {t("billing.cancelInvoice")}
              </button>
            )}
            {invoice.status === "PAID" && canPay && (
              <button onClick={() => setConfirmUndo(true)} className="block w-full py-1.5 text-center text-[13px] text-faint transition-colors hover:text-review">
                {t("billing.undoPayment")}
              </button>
            )}
          </div>
        }
      >
        <div className="pb-2">
          <div className="divide-y divide-line">
            {items.map((item) => {
              const project = scope.idx.projectById.get(item.projectId);
              return (
                <div key={item.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{item.description}</span>
                      {item.originalName && item.originalName !== item.description && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-faint">Original: {item.originalName}</span>
                      )}
                      <span className="mt-0.5 block truncate text-[12px] text-faint">{project?.name}</span>
                    </span>
                    <Amount value={money(item.amount)} className="text-[14px]" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                    <span>Unit {money(item.unitPrice)}</span>
                    <span>Qty {item.quantity}</span>
                    <span>Discount {discountLabel((item.discountType ?? "NONE") as BillingDiscountType, item.discountValue ?? 0)}</span>
                    <span>Sub Total {money(item.amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1 flex items-center justify-between border-t border-line-strong pt-3">
            <span className="text-[14px] font-medium">{t("common.total")}</span>
            <CurrencyAmount usd={invoice.amount} rate={invoice.exchangeRate} strong className="text-[17px]" />
          </div>

          <dl className="mt-5 space-y-2.5 text-[13.5px]">
            <Detail label={t("billing.invoiceDate")}>{mediumDate(invoice.invoiceDate, locale)}</Detail>
            {invoice.poNumber && <Detail label="PO Number">{invoice.poNumber}</Detail>}
            <Detail label="PLT Format">{pltLabel(invoice.pltFormat)}</Detail>
            <Detail label="Parent Company">{invoice.showParentCompany ? invoice.parentCompanyName || "—" : "Hidden"}</Detail>
            <Detail label="VAT">{invoice.noVat ? "No VAT" : invoice.stateChargeVat ? "State Charge VAT" : "Standard / unchanged"}</Detail>
            {invoice.customerNote && <Detail label="Customer Note">{invoice.customerNote}</Detail>}
            {invoice.staffNote && <Detail label="Staff Note (internal)">{invoice.staffNote}</Detail>}
            {invoice.paymentDate && <Detail label={t("billing.paymentDate")}>{mediumDate(invoice.paymentDate, locale)}</Detail>}
            {invoice.paymentSlip && <Detail label={t("billing.paymentSlip")}>{invoice.paymentSlip}</Detail>}
            <Detail label={t("billing.receiptStatus")}>{t(`receipt.${invoice.receiptStatus}`)}</Detail>
            <Detail label={t("common.status")}>{invoice.status === "PAID" ? t("status.PAID") : t("status.INVOICED")}</Detail>
            {invoice.exchangeRate && invoice.exchangeRate > 0 && (
              <Detail label={t("currency.rateLabel")}>{t("currency.rate", { rate: invoice.exchangeRate })}</Detail>
            )}
          </dl>
        </div>
      </Sheet>

      <Sheet
        open={paying}
        onClose={() => setPaying(false)}
        title={t("billing.confirmPayment")}
        description={[invoice.invoiceNumber, money(invoice.amount)].filter(Boolean).join(" · ")}
        footer={
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Button variant="secondary" full onClick={() => setPaying(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" full onClick={confirmPayment} disabled={busy}>{t("common.confirm")}</Button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <Field label={t("billing.paymentDate")}>
            <Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="tnum" />
          </Field>
          <Field label={t("billing.paymentSlip")} hint={t("common.optional")}>
            <Input value={slip} onChange={(event) => setSlip(event.target.value)} placeholder={t("billing.paymentSlipPlaceholder")} />
          </Field>
        </div>
      </Sheet>

      <ConfirmSheet open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancelInvoice} title={t("billing.cancelInvoice")} message={t("billing.cancelInvoiceConfirm")} confirmLabel={t("billing.cancelInvoice")} busy={busy} />
      <ConfirmSheet open={confirmUndo} onClose={() => setConfirmUndo(false)} onConfirm={undoPayment} title={t("billing.undoPayment")} message={t("billing.undoPaymentConfirm")} confirmLabel={t("billing.undoPayment")} busy={busy} />
    </>
  );
}

function pltLabel(value?: PltFormat) {
  if (value === "IMPORT_PRODUCT") return "Import Product";
  if (value === "DISTRIBUTOR") return "Distributor";
  return "Normal";
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}
