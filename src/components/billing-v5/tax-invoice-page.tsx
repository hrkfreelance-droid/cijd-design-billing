"use client";

import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { api, useData, useToast } from "@/components/providers";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { useV5T } from "@/lib/billing-v5/i18n";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import { FitA4 } from "./fit-a4";
import { InvoiceDocument } from "./invoice-document";

/**
 * An issued Tax Invoice, reopened. Everything shown comes from the record
 * frozen at issue; Print / Save PDF prints the A4 sheet and nothing else.
 */
export function TaxInvoicePage({ id }: { id: string }) {
  const t = useV5T();
  const { snapshot } = useData();
  const { toast } = useToast();
  const { run, busy } = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  if (!snapshot) return <p className="px-5 pt-24 text-center text-[14px] text-muted">…</p>;
  const invoice = (snapshot.taxInvoices ?? []).find((entry) => entry.id === id);
  const clientName = invoice ? (snapshot.clients.find((client) => client.id === invoice.clientId)?.name ?? "") : "";

  const cancel = async () => {
    const ok = await run(() => api(`/api/v5/tax-invoices/${id}/cancel`, { method: "POST", body: { reason } }));
    setCancelling(false);
    if (ok) toast(t("invoice.cancelled"));
  };

  return (
    <div className="pb-16">
      <div className="v5-no-print header-surface sticky top-0 z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto flex min-h-[52px] max-w-[960px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2 sm:px-8">
          <Link href="/office-v5/accounting" className="text-[13.5px] font-medium text-accent hover:underline" data-testid="v5-invoice-back">
            ← {t("invoice.back")}
          </Link>
          {invoice && (
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
              <span className="tnum font-semibold text-text" data-testid="v5-invoice-heading">{invoice.invoiceNumber}</span>
              {" · "}
              <span className={invoice.status === "CANCELLED" ? "text-danger" : ""} data-testid="v5-invoice-status">
                {t(`invoice.status.${invoice.status}`)}
              </span>
              {" · "}
              {clientName} · {invoice.project.name} · <span className="tnum">{moneyExact(invoice.totalUsd)}</span>
            </span>
          )}
          {invoice && (
            <div className="ml-auto flex items-center gap-2">
              {invoice.status === "ISSUED" && (
                <Button variant="quiet" size="sm" onClick={() => setCancelling(true)} data-testid="v5-invoice-cancel">
                  {t("invoice.cancel")}
                </Button>
              )}
              <Button variant="primary" onClick={() => window.print()} data-testid="v5-print">
                {t("invoice.print")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {!invoice ? (
        <p className="px-5 pt-24 text-center text-[14px] text-muted" data-testid="v5-invoice-missing">{t("invoice.notFound")}</p>
      ) : (
        <>
          <p className="v5-no-print mx-auto max-w-[210mm] px-5 pt-4 text-[12px] text-faint sm:px-0">
            {t("invoice.issuedOn", { date: phnomPenhDate(new Date(invoice.issuedAt)), name: invoice.issuedBy })}
            {invoice.cancellationReason ? ` · ${invoice.cancellationReason}` : ""}
          </p>
          <div className="mx-auto mt-3 max-w-[210mm] px-3 sm:px-0">
            <div className="v5-print-root">
              <FitA4>
                <InvoiceDocument invoice={invoice} />
              </FitA4>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() => void cancel()}
        busy={busy || !reason.trim()}
        tone="destructive"
        title={t("invoice.cancelTitle")}
        message={
          <>
            <span className="block">{t("invoice.cancelBody")}</span>
            <label className="mt-3 block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("invoice.cancelReason")}</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} data-testid="v5-cancel-reason" />
            </label>
          </>
        }
        confirmLabel={t("invoice.cancel")}
        testId="v5-confirm-cancel"
      />
    </div>
  );
}
