"use client";

import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { api, useToast } from "@/components/providers";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { invoiceActionAvailability } from "@/lib/billing-v5/invoice-action-availability";
import { useV5T } from "@/lib/billing-v5/i18n";
import type { Snapshot, TaxInvoiceRecord } from "@/lib/types";
import { InvoiceEditor } from "./invoice-editor";


/** Existing operations and dialogs, shared without changing mutation payloads. */
export function InvoiceActions({ invoice, snapshot, compact = false }: { invoice: TaxInvoiceRecord; snapshot: Snapshot; compact?: boolean }) {
  const t = useV5T();
  const { toast } = useToast();
  const { run, busy } = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [creatingFinal, setCreatingFinal] = useState(false);
  const { depositLocked, laterDeposit, canIssueFinal } = invoiceActionAvailability(snapshot, invoice);
  const className = compact ? "iv-button" : undefined;
  const cancel = async () => {
    const ok = await run(() => api(`/api/v5/tax-invoices/${invoice.id}/cancel`, { method: "POST", body: { reason } }));
    setCancelling(false);
    if (ok) toast(t("invoice.cancelled"));
  };
  return <>
    {canIssueFinal && <Button variant="secondary" size="sm" className={className} onClick={() => setCreatingFinal(true)} data-testid="v5-issue-final">{t("invoice.issueFinal")}</Button>}
    {invoice.status === "ISSUED" && !depositLocked && !laterDeposit && <>
      <Button variant="quiet" size="sm" className={className} onClick={() => setCancelling(true)} data-testid="v5-invoice-cancel">{t("invoice.cancel")}</Button>
      <Button variant="secondary" size="sm" className={className} onClick={() => setEditing(true)} data-testid="v5-invoice-edit">{t("detail.edit")}</Button>
    </>}
    {compact
      ? <Link className="iv-button" href={`/office-v5/tax-invoices/${encodeURIComponent(invoice.id)}?print=1`} target="_blank" rel="noopener noreferrer" data-testid="v5-panel-print">{t("invoice.print")}</Link>
      : <Button variant="primary" onClick={() => window.print()} data-testid="v5-print">{t("invoice.print")}</Button>}
    {editing && <InvoiceEditor mode="edit" snapshot={snapshot} invoice={invoice} onClose={() => setEditing(false)} />}
    {creatingFinal && invoice.contractId && invoice.contractSnapshot && <InvoiceEditor
      mode="create" snapshot={snapshot} customerId={invoice.clientId}
      billingItemIds={invoice.contractSnapshot.lines.map((line) => line.billingItemId)}
      initialKind="FINAL" initialContractId={invoice.contractId} onClose={() => setCreatingFinal(false)}
    />}
    <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} onConfirm={() => void cancel()}
      busy={busy || !reason.trim()} tone="destructive" title={t("invoice.cancelTitle")}
      message={<>
        <span className="block">{t("invoice.cancelBody")}</span>
        <label className="mt-3 block"><span className="mb-1 block text-[12px] font-medium text-muted">{t("invoice.cancelReason")}</span>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} data-testid="v5-cancel-reason" />
        </label>
      </>}
      confirmLabel={t("invoice.cancel")} testId="v5-confirm-cancel"
    />
  </>;
}
