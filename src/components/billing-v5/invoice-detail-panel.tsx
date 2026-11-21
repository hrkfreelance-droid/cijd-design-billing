"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/providers";
import { MobileBottomSheet } from "@/components/ui/mobile-bottom-sheet";
import { useAction } from "@/components/use-action";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { moneyExact } from "@/lib/format";
import type { Snapshot, TaxInvoiceRecord } from "@/lib/types";
import { FitA4 } from "./fit-a4";
import { InvoiceDocument } from "./invoice-document";
import { InvoiceActions } from "./invoice-actions";
import { invoiceDocumentText } from "./invoice-text";
import { Payments } from "./tax-invoice-page";

export function useInvoiceSheet() {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const update = () => setSheet(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return sheet;
}

export function InvoiceStatus({ status }: { status: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED" }) {
  const t = useV5T();
  return <span className="iv-status" data-status={status} data-testid="v5-row-status"><i aria-hidden />{t(`status.${status}` as V5Key)}</span>;
}

export function InvoiceDetailPanel({ invoice, snapshot, onClose, sheet }: {
  invoice: TaxInvoiceRecord; snapshot: Snapshot; onClose: () => void; sheet: boolean;
}) {
  const t = useV5T();
  const { t: common, locale } = useI18n();
  const { run, busy } = useAction();
  const [tab, setTab] = useState<"preview" | "text">("preview");
  const [documentText, setDocumentText] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);
  const paymentsRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const money = invoiceCollection(snapshot, invoice);
  const href = `/office-v5/tax-invoices/${encodeURIComponent(invoice.id)}`;
  const openLabel = locale === "ja" ? "新しいタブで開く" : locale === "kh" ? "បើកក្នុងផ្ទាំងថ្មី" : "Open in new tab";
  // These supplement the printed document with current collection data. They
  // deliberately use English, as on the invoice, regardless of the UI locale.
  const text = [documentText, `Subject: ${invoice.project.name}`, `Paid (USD): ${moneyExact(money.paidUsd)}`,
    `Outstanding (USD): ${invoice.status === "CANCELLED" ? "—" : moneyExact(money.outstandingUsd)}`].join("\n\n");

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const showText = () => {
    if (documentRef.current) setDocumentText(invoiceDocumentText(documentRef.current));
    setTab("text");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(false);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "preview" : event.key === "End" ? "text" : tab === "preview" ? "text" : "preview";
    if (next === "text") showText(); else setTab("preview");
    document.getElementById(`iv-${next}-tab`)?.focus();
  };

  const summary = <div className="iv-summary">
    <span className="iv-customer" title={invoice.customer.companyNameEn || invoice.customer.companyNameKm}>{invoice.customer.companyNameEn || invoice.customer.companyNameKm}</span>
    <time className="tnum">{invoice.invoiceDate}</time>
    <InvoiceStatus status={invoice.status === "CANCELLED" ? "CANCELLED" : money.status} />
    <strong className="tnum">{moneyExact(invoice.totalUsd)}</strong>
  </div>;
  const content = <>
    <div className="iv-tools">
      {invoice.status === "ISSUED" && money.outstandingUsd > 0 && <button type="button" className="iv-button" onClick={() => {
        paymentsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        paymentsRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      }}>{t("detail.addPayment")}</button>}
      <InvoiceActions invoice={invoice} snapshot={snapshot} compact />
    </div>
    <div className="iv-tabs" role="tablist" aria-label={invoice.invoiceNumber}>
      <button id="iv-preview-tab" type="button" role="tab" aria-selected={tab === "preview"} aria-controls="iv-preview" tabIndex={tab === "preview" ? 0 : -1} onClick={() => setTab("preview")} onKeyDown={tabKey}>Preview</button>
      <button id="iv-text-tab" type="button" role="tab" aria-selected={tab === "text"} aria-controls="iv-text" tabIndex={tab === "text" ? 0 : -1} onClick={showText} onKeyDown={tabKey}>Text</button>
    </div>
    <div className="iv-preview" id="iv-preview" role="tabpanel" aria-labelledby="iv-preview-tab" hidden={tab !== "preview"}>
      <Link href={href} target="_blank" rel="noopener noreferrer" className="iv-open" data-testid="v5-preview-open">{openLabel} ↗</Link>
      <div ref={documentRef} className="iv-document" lang="en">
        <FitA4><InvoiceDocument invoice={invoice} /></FitA4>
      </div>
    </div>
    <div className="iv-text" id="iv-text" role="tabpanel" aria-labelledby="iv-text-tab" hidden={tab !== "text"}>
      <div className="iv-copy"><button type="button" className="iv-button" onClick={() => void copy()} data-testid="v5-invoice-copy">{copied ? "Copied" : "Copy"}</button><span role="status" className={copyError ? undefined : "sr-only"}>{copyError ? (locale === "ja" ? "文字を選択してコピーしてください。" : locale === "kh" ? "សូមជ្រើសអត្ថបទដើម្បីចម្លង។" : "Select the text to copy it.") : copied ? "Copied" : ""}</span></div>
      <pre tabIndex={0} lang="en" data-base-ui-swipe-ignore data-testid="v5-invoice-text">{text}</pre>
    </div>
    <div className="iv-payments" ref={paymentsRef}>
      <Payments invoice={invoice} snapshot={snapshot} money={money} run={run} busy={busy} />
    </div>
  </>;

  if (sheet) return <MobileBottomSheet open onClose={onClose} closeLabel={common("common.close")} title={invoice.invoiceNumber} subtitle={summary} contentClassName="iv-detail iv-sheet-content" testId="v5-invoice-detail-sheet">{content}</MobileBottomSheet>;
  return <aside className="iv-detail iv-panel" aria-label={invoice.invoiceNumber} data-testid="v5-invoice-detail-panel">
    <header className="iv-detail-head"><div><h2>{invoice.invoiceNumber}</h2>{summary}</div><button type="button" className="iv-button iv-close" aria-label={common("common.close")} onClick={onClose}>×</button></header>
    {content}
  </aside>;
}
