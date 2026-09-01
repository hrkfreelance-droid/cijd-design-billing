"use client";

import { useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useSession } from "@/components/providers";
import { useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import {
  Amount,
  Button,
  ConfirmSheet,
  Field,
  Input,
  Sheet,
} from "@/components/ui";
import { mediumDate, money, todayIso } from "@/lib/format";
import { can } from "@/lib/auth/roles";
import type { Invoice } from "@/lib/types";

/**
 * One invoice, one place. Billing and Archive both open this so the rules
 * around payment and cancellation only exist once.
 */
export function InvoiceSheet({
  invoice,
  onClose,
}: {
  invoice: Invoice | null;
  onClose: () => void;
}) {
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

  const confirmPayment = async () => {
    const ok = await run(
      () =>
        api(`/api/invoices/${invoice.id}/payment`, {
          method: "POST",
          body: { paymentDate, slip },
        }),
      { key: "toast.paymentConfirmed" },
    );
    if (ok) {
      setPaying(false);
      setSlip("");
      onClose();
    }
  };

  const cancelInvoice = async () => {
    const ok = await run(
      () => api(`/api/invoices/${invoice.id}`, { method: "DELETE" }),
      { key: "toast.invoiceCancelled" },
    );
    setConfirmCancel(false);
    if (ok) onClose();
  };

  const undoPayment = async () => {
    const ok = await run(
      () => api(`/api/invoices/${invoice.id}/payment`, { method: "DELETE" }),
      { key: "toast.paymentReverted" },
    );
    setConfirmUndo(false);
    if (ok) onClose();
  };

  const markReceiptSent = async () => {
    const ok = await run(
      () =>
        api(`/api/invoices/${invoice.id}`, {
          method: "PATCH",
          body: { receiptStatus: "RECEIVED" },
        }),
      { key: "toast.receiptUpdated" },
    );
    if (ok) onClose();
  };

  return (
    <>
      <Sheet
        open={!paying}
        onClose={onClose}
        title={invoice.invoiceNumber ?? "Unknown"}
        description={client?.name}
        footer={
          <div className="space-y-2">
            {invoice.status === "ISSUED" && canPay && (
              <Button variant="primary" full onClick={() => setPaying(true)}>
                {t("billing.confirmPayment")}
              </Button>
            )}
            {invoice.status === "PAID" && invoice.receiptStatus === "PENDING" && canPay && (
              <Button variant="primary" full onClick={markReceiptSent} disabled={busy}>
                {t("billing.receiptSent")}
              </Button>
            )}
            <Button variant="secondary" full onClick={onClose}>
              {t("common.close")}
            </Button>
            {invoice.status === "ISSUED" && canInvoice && (
              <button
                onClick={() => setConfirmCancel(true)}
                className="block w-full py-1.5 text-center text-[13px] text-faint transition-colors hover:text-review"
              >
                {t("billing.cancelInvoice")}
              </button>
            )}
            {invoice.status === "PAID" && canPay && (
              <button
                onClick={() => setConfirmUndo(true)}
                className="block w-full py-1.5 text-center text-[13px] text-faint transition-colors hover:text-review"
              >
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
                <div key={item.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{item.description}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-faint">
                      {project?.name}
                    </span>
                  </span>
                  <Amount value={money(item.amount)} className="text-[14px]" />
                </div>
              );
            })}
          </div>

          <div className="mt-1 flex items-center justify-between border-t border-line-strong pt-3">
            <span className="text-[14px] font-medium">{t("common.total")}</span>
            <Amount value={money(invoice.amount)} strong className="text-[17px]" />
          </div>

          <dl className="mt-5 space-y-2.5 text-[13.5px]">
            <Detail label={t("billing.invoiceDate")}>
              {mediumDate(invoice.invoiceDate, locale)}
            </Detail>
            {invoice.paymentDate && (
              <Detail label={t("billing.paymentDate")}>
                {mediumDate(invoice.paymentDate, locale)}
              </Detail>
            )}
            {invoice.paymentSlip && (
              <Detail label={t("billing.paymentSlip")}>{invoice.paymentSlip}</Detail>
            )}
            <Detail label={t("billing.receiptStatus")}>
              {t(`receipt.${invoice.receiptStatus}`)}
            </Detail>
            <Detail label={t("common.status")}>
              {invoice.status === "PAID" ? t("status.PAID") : t("status.INVOICED")}
            </Detail>
          </dl>
        </div>
      </Sheet>

      <Sheet
        open={paying}
        onClose={() => setPaying(false)}
        title={t("billing.confirmPayment")}
        description={`${invoice.invoiceNumber ?? "Unknown"} · ${money(invoice.amount)}`}
        footer={
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Button variant="secondary" full onClick={() => setPaying(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" full onClick={confirmPayment} disabled={busy}>
              {t("common.confirm")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <Field label={t("billing.paymentDate")}>
            <Input
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              className="tnum"
            />
          </Field>
          <Field label={t("billing.paymentSlip")} hint={t("common.optional")}>
            <Input
              value={slip}
              onChange={(event) => setSlip(event.target.value)}
              placeholder={t("billing.paymentSlipPlaceholder")}
            />
          </Field>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancelInvoice}
        title={t("billing.cancelInvoice")}
        message={t("billing.cancelInvoiceConfirm")}
        confirmLabel={t("billing.cancelInvoice")}
        busy={busy}
      />

      <ConfirmSheet
        open={confirmUndo}
        onClose={() => setConfirmUndo(false)}
        onConfirm={undoPayment}
        title={t("billing.undoPayment")}
        message={t("billing.undoPaymentConfirm")}
        confirmLabel={t("billing.undoPayment")}
        busy={busy}
      />
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
