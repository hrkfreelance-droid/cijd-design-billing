"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { Modal } from "@/components/billing-v2/modal";
import { Price, ProjectDetail } from "@/components/billing-v2/project-detail";
import { api, useI18n, useToast } from "@/components/providers";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { billingBoard, type BoardGroup, type BoardItem, type BoardProject } from "@/lib/billing-v2/board";
import { serviceLabel } from "@/lib/billing-v2/services";
import {
  hasErrors,
  invoiceUnitPrice,
  nextTaxInvoiceNumber,
  projectPaymentsWithLegacyDeposit,
  roundMoney,
  settlement,
  taxTotals,
  validatePayment,
} from "@/lib/billing-v5/calculation";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import type { ExchangeRate, ProjectPaymentKind, Snapshot, TaxInvoiceRecord } from "@/lib/types";
import { InvoiceDocument, INVOICE_ROWS, type InvoiceView } from "./invoice-document";
import { FitA4 } from "./fit-a4";

const khr = (value: number) => `${value.toLocaleString("en-US")} ៛`;

/**
 * Accounting: the step after the designer's "ready to bill".
 *
 * Built from the Billing screen's own parts — the same list, the same project
 * sheet — so it reads as the next page of V3, not a separate application.
 * Every figure comes from the V5 calculation layer; nothing here changes a
 * designer's Final price.
 */
export function AccountingBoard({ snapshot }: { snapshot: Snapshot }) {
  const t = useV5T();
  const board = useMemo(() => billingBoard(snapshot), [snapshot]);
  const [openId, setOpenId] = useState<string | null>(null);

  const lookup = useMemo(() => {
    const map = new Map<string, { project: BoardProject; clientName: string; clientId: string }>();
    for (const group of board.ready) {
      for (const project of group.projects) map.set(project.id, { project, clientName: group.client.name, clientId: group.client.id });
    }
    return map;
  }, [board]);
  const open = openId ? lookup.get(openId) : undefined;
  const issued = (snapshot.taxInvoices ?? []).filter((invoice) => invoice.status === "ISSUED");

  return (
    <div className="pb-16" data-testid="v5-accounting">
      <header className="px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] sm:text-[30px]">{t("accounting.title")}</h1>
        <p className="mt-1 text-[13.5px] text-muted">{t("accounting.subtitle")}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-12">
          <Figure label={t("accounting.toInvoice")} strong testId="v5-to-invoice-total">
            {moneyExact(board.readyTotal)}
          </Figure>
          <Figure label={t("accounting.issued")}>{issued.length}</Figure>
          <Figure label={t("accounting.rate")} testId="v5-rate">
            {snapshot.exchangeRate ? snapshot.exchangeRate.rate.toLocaleString("en-US") : t("accounting.rateNone")}
          </Figure>
        </dl>
      </header>

      <div className="px-5 sm:px-8">
        <section className="pt-9" data-testid="v5-section-to-invoice">
          <SectionHeading label={t("accounting.toInvoice")} count={board.readyCount} total={board.readyTotal} />
          {board.ready.length === 0 ? (
            <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("accounting.toInvoiceEmpty")}</p>
          ) : (
            board.ready.map((group) => (
              <ClientGroup key={group.client.id} group={group}>
                {group.projects.map((project) => (
                  <AccountingRow key={project.id} project={project} snapshot={snapshot} onOpen={() => setOpenId(project.id)} />
                ))}
              </ClientGroup>
            ))
          )}
        </section>

        <TaxInvoiceList snapshot={snapshot} />
      </div>

      {open && (
        <AccountingProjectModal
          key={open.project.id}
          project={open.project}
          clientName={open.clientName}
          snapshot={snapshot}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function Figure({ label, children, strong = false, testId }: { label: string; children: ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd
        className={`tnum mt-0.5 truncate leading-tight tracking-[-0.02em] ${strong ? "text-[22px] font-semibold" : "text-[17px] font-medium text-text/85"}`}
        data-testid={testId}
      >
        {children}
      </dd>
    </div>
  );
}

function SectionHeading({ label, count, total }: { label: string; count: number; total?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 pb-1">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
        <span className="tnum ml-2 font-normal text-faint">{count}</span>
      </h2>
      {total !== undefined && <span className="tnum text-[13px] font-medium text-muted">{moneyExact(total)}</span>}
    </div>
  );
}

function ClientGroup({ group, children }: { group: BoardGroup; children: ReactNode }) {
  return (
    <div className="pt-3" data-testid="v5-client-group">
      <div className="flex items-center justify-between border-b border-line-strong">
        <h3 className="min-w-0 truncate py-2.5 text-[16px] font-semibold tracking-[-0.012em]">{group.client.name}</h3>
        <span className="tnum shrink-0 pl-4 text-[15px] font-semibold">{moneyExact(group.total)}</span>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function projectSettlement(project: BoardProject, snapshot: Snapshot) {
  const row = snapshot.projects.find((candidate) => candidate.id === project.id);
  const payments = projectPaymentsWithLegacyDeposit(
    { id: project.id, depositAmount: row?.depositAmount ?? null, date: row?.date },
    snapshot.projectPayments ?? [],
  );
  return { payments, result: settlement(project.total, payments) };
}

/** One invoice-ready project: memo and lines visible without opening it. */
function AccountingRow({ project, snapshot, onOpen }: { project: BoardProject; snapshot: Snapshot; onOpen: () => void }) {
  const t = useV5T();
  const { result } = projectSettlement(project, snapshot);
  return (
    <li className="border-b border-line" data-project-id={project.id} data-testid="v5-accounting-row">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("accounting.open", { name: project.name })}
        className="group block w-full min-w-0 py-3.5 text-left"
        data-testid="v5-open-project"
      >
        <span className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 text-[15px] font-medium leading-snug tracking-[-0.01em] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
            {project.name}
          </span>
          <span className="tnum shrink-0 text-[15px] font-semibold" data-testid="v5-row-total">
            {moneyExact(project.total)}
          </span>
        </span>
        {project.note.trim() && (
          <span className="mt-1 line-clamp-2 block whitespace-pre-line text-[13px] text-text/80" data-testid="v5-row-memo">
            <span className="text-muted">{t("accounting.memo")} · </span>
            {project.note}
          </span>
        )}
        {result.paid > 0 && (
          <span className="tnum mt-0.5 block text-[12.5px] text-muted">
            {t("balance.paid")} {moneyExact(result.paid)} · <span className="font-medium text-text">{t("balance.remaining")} {moneyExact(result.balance)}</span>
          </span>
        )}
        <span className="mt-1.5 block space-y-[3px]">
          {project.items.map((entry) => (
            <LineSummary key={entry.item.id} entry={entry} />
          ))}
        </span>
      </button>
    </li>
  );
}

function LineSummary({ entry }: { entry: BoardItem }) {
  const { t } = useI18n();
  const label = serviceLabel(entry.service, t);
  const description = entry.item.description.trim();
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[13px] leading-5" data-testid="v5-line">
      <span className="min-w-0 truncate">
        <span className="text-muted">{label}</span>
        {description && description.toLowerCase() !== label.toLowerCase() && <span className="text-text/90"> · {description}</span>}
        <span className="tnum text-faint"> ×{entry.item.quantity}</span>
      </span>
      <Price value={entry.amount} className="text-right text-muted" />
    </span>
  );
}

/* ------------------------------------------------------------- issued list */

export function TaxInvoiceList({ snapshot }: { snapshot: Snapshot }) {
  const t = useV5T();
  const clientName = (id: string) => snapshot.clients.find((client) => client.id === id)?.name ?? "";
  const invoices = [...(snapshot.taxInvoices ?? [])].sort(
    (a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.invoiceNumber.localeCompare(a.invoiceNumber),
  );
  return (
    <section className="pt-10" data-testid="v5-section-issued">
      <SectionHeading label={t("accounting.issued")} count={invoices.filter((invoice) => invoice.status === "ISSUED").length} />
      {invoices.length === 0 ? (
        <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("accounting.issuedEmpty")}</p>
      ) : (
        <ul className="border-t border-line-strong">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="border-b border-line">
              <Link
                href={`/office-v5/tax-invoices/${invoice.id}`}
                aria-label={t("invoice.open", { number: invoice.invoiceNumber })}
                className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-3 sm:grid-cols-[9.5rem_6.5rem_minmax(0,1fr)_7.5rem]"
                data-testid="v5-issued-row"
              >
                <span className="tnum text-[14px] font-medium group-hover:underline group-hover:underline-offset-4">
                  {invoice.invoiceNumber}
                  {invoice.status === "CANCELLED" && (
                    <span className="ml-2 text-[12px] font-normal text-danger">{t("invoice.status.CANCELLED")}</span>
                  )}
                </span>
                <span className="tnum hidden text-[13px] text-muted sm:block">{invoice.invoiceDate}</span>
                <span className="col-span-2 min-w-0 truncate text-[13px] text-muted sm:col-span-1 sm:row-start-1 sm:col-start-3">
                  {clientName(invoice.clientId)} · {invoice.project.name}
                </span>
                <span className={`tnum row-start-1 col-start-2 text-right text-[14px] font-semibold sm:col-start-4 ${invoice.status === "CANCELLED" ? "text-faint line-through" : ""}`}>
                  {moneyExact(invoice.totalUsd)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------ the project sheet */

type Mode = "view" | "prepare" | "preview";

interface InvoiceForm {
  companyNameEn: string;
  companyNameKm: string;
  addressEn: string;
  addressKm: string;
  telephone: string;
  vatin: string;
  invoiceNumber: string;
  invoiceDate: string;
  rate: string;
  rateSource: "NBC" | "MANUAL";
  rateDate: string | null;
  vatApplicable: boolean;
}

function initialForm(snapshot: Snapshot, clientId: string, clientName: string): InvoiceForm {
  const profile = (snapshot.clientTaxProfiles ?? []).find((entry) => entry.clientId === clientId);
  const today = phnomPenhDate();
  const numbers = [
    ...(snapshot.taxInvoices ?? []).map((invoice) => invoice.invoiceNumber),
    ...snapshot.invoices.map((invoice) => invoice.invoiceNumber ?? ""),
  ];
  const rate = snapshot.exchangeRate;
  return {
    companyNameEn: profile?.companyNameEn ?? clientName,
    companyNameKm: profile?.companyNameKm ?? "",
    addressEn: profile?.addressEn ?? "",
    addressKm: profile?.addressKm ?? "",
    telephone: profile?.telephone ?? "",
    vatin: profile?.vatin ?? "",
    invoiceNumber: nextTaxInvoiceNumber(Number(today.slice(0, 4)), numbers),
    invoiceDate: today,
    rate: rate ? String(rate.rate) : "",
    rateSource: rate ? "NBC" : "MANUAL",
    rateDate: rate?.effectiveDate ?? null,
    vatApplicable: true,
  };
}

function AccountingProjectModal({
  project,
  clientName,
  snapshot,
  onClose,
}: {
  project: BoardProject;
  clientName: string;
  snapshot: Snapshot;
  onClose: () => void;
}) {
  const t = useV5T();
  const { t: t3 } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const { run, runResult, busy } = useAction();
  const [mode, setMode] = useState<Mode>("view");
  const [form, setForm] = useState<InvoiceForm>(() => initialForm(snapshot, project.clientId, clientName));
  const [confirming, setConfirming] = useState(false);
  const [fetching, setFetching] = useState(false);

  const set = <K extends keyof InvoiceForm>(key: K, value: InvoiceForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const rate = Number(form.rate);
  const rateValid = form.rate.trim() !== "" && Number.isFinite(rate) && rate > 0;
  const lines = project.items.map((entry) => ({
    billingItemId: entry.item.id,
    description: entry.item.description.trim() || serviceLabel(entry.service, t3),
    quantity: entry.item.quantity,
    unitPrice: invoiceUnitPrice({ quantity: entry.item.quantity, unitPrice: entry.finalUnitPrice, amount: entry.amount ?? 0 }),
    amount: roundMoney(entry.amount ?? 0),
  }));
  const totals = taxTotals({ lines, vatApplicable: form.vatApplicable, exchangeRate: rateValid ? rate : 0 });

  const errors: V5Key[] = [];
  if (!form.companyNameEn.trim() && !form.companyNameKm.trim()) errors.push("prepare.errName");
  if (!rateValid) errors.push("prepare.errRate");
  if (!form.invoiceNumber.trim()) errors.push("prepare.errNumber");
  const tooManyLines = lines.length > INVOICE_ROWS;

  const view: InvoiceView = {
    projectId: project.id,
    clientId: project.clientId,
    invoiceNumber: form.invoiceNumber,
    invoiceDate: form.invoiceDate,
    status: "ISSUED",
    customer: {
      companyNameEn: form.companyNameEn,
      companyNameKm: form.companyNameKm,
      addressEn: form.addressEn,
      addressKm: form.addressKm,
      telephone: form.telephone,
      vatin: form.vatin,
    },
    project: { name: project.name, note: project.note },
    lines,
    vatApplicable: form.vatApplicable,
    vatPercent: totals.vatPercent,
    subtotalUsd: totals.subtotalUsd,
    vatUsd: totals.vatUsd,
    totalUsd: totals.totalUsd,
    exchangeRate: rateValid ? rate : 0,
    exchangeRateSource: form.rateSource,
    exchangeRateEffectiveDate: form.rateDate,
    totalKhr: totals.totalKhr,
    draft: true,
  };

  const fetchRate = async () => {
    setFetching(true);
    try {
      const result = await api<{ fetched: true; rate: ExchangeRate } | { fetched: false; message: string }>("/api/v5/exchange-rate", {
        method: "POST",
      });
      if (!result.fetched) {
        toast(t("prepare.fetchFailed"), "error");
        return;
      }
      const fetched = result.rate;
      setForm((current) => ({ ...current, rate: String(fetched.rate), rateSource: "NBC", rateDate: fetched.effectiveDate }));
    } catch {
      toast(t("prepare.fetchFailed"), "error");
    } finally {
      setFetching(false);
    }
  };

  const issue = async () => {
    const record = await runResult(() =>
      api<TaxInvoiceRecord>("/api/v5/tax-invoices", {
        method: "POST",
        body: {
          projectId: project.id,
          invoiceNumber: form.invoiceNumber.trim(),
          invoiceDate: form.invoiceDate,
          customer: view.customer,
          exchangeRate: rate,
          exchangeRateSource: form.rateSource,
          exchangeRateEffectiveDate: form.rateSource === "NBC" ? form.rateDate : null,
          vatApplicable: form.vatApplicable,
        },
      }),
    );
    setConfirming(false);
    if (record) {
      toast(t("prepare.issued", { number: record.invoiceNumber }));
      router.push(`/office-v5/tax-invoices/${record.id}`);
    }
  };

  const canIssue = errors.length === 0 && !tooManyLines;
  const status = `${t3("v2.section.ready")} · ${t("accounting.lines", { count: project.items.length })}`;

  const footer =
    mode === "view" ? (
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[12.5px] text-muted">{t("prepare.finalNote")}</span>
        <Button variant="primary" onClick={() => setMode("prepare")} data-testid="v5-prepare">
          {t("accounting.prepare")}
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Button variant="secondary" onClick={() => setMode(mode === "preview" ? "prepare" : "view")} disabled={busy} data-testid="v5-back">
          {mode === "preview" ? t("prepare.edit") : t3("common.cancel")}
        </Button>
        <span className="tnum ml-auto min-w-0 text-right">
          <span className="block text-[11.5px] text-muted">{t("prepare.totalUsd")}</span>
          <span className="block text-[18px] font-semibold leading-tight tracking-[-0.02em]">{moneyExact(totals.totalUsd)}</span>
        </span>
        {mode === "prepare" && (
          <Button variant="secondary" onClick={() => setMode("preview")} disabled={!canIssue} data-testid="v5-preview">
            {t("prepare.preview")}
          </Button>
        )}
        <Button variant="primary" onClick={() => setConfirming(true)} disabled={!canIssue || busy} data-testid="v5-issue">
          {t("prepare.issue")}
        </Button>
      </div>
    );

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      kicker={clientName}
      title={mode === "view" ? project.name : `${t("prepare.title")} · ${project.name}`}
      subtitle={<span>{status}</span>}
      closeLabel={t3("common.close")}
      footer={footer}
      testId="v5-accounting-modal"
    >
      {mode === "view" && (
        <>
          <MemoAndDetails project={project} snapshot={snapshot} clientName={clientName} />
          <div className="mt-6">
            {/* The memo is shown above; the table below is V3's own. */}
            <ProjectDetail project={{ ...project, note: "" }} />
          </div>
          <PaymentsPanel project={project} snapshot={snapshot} run={run} />
        </>
      )}

      {mode === "prepare" && (
        <div data-testid="v5-prepare-form">
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-[13px] font-semibold">{t("prepare.customer")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t("prepare.nameEn")} value={form.companyNameEn} onChange={(v) => set("companyNameEn", v)} testId="v5-name-en" />
                <TextField label={t("prepare.nameKm")} value={form.companyNameKm} onChange={(v) => set("companyNameKm", v)} testId="v5-name-km" lang="km" />
                <TextField label={t("prepare.addressEn")} value={form.addressEn} onChange={(v) => set("addressEn", v)} testId="v5-address-en" />
                <TextField label={t("prepare.addressKm")} value={form.addressKm} onChange={(v) => set("addressKm", v)} testId="v5-address-km" lang="km" />
                <TextField label={t("prepare.phone")} value={form.telephone} onChange={(v) => set("telephone", v)} testId="v5-phone" />
                <TextField label={t("prepare.vatin")} value={form.vatin} onChange={(v) => set("vatin", v)} testId="v5-vatin" />
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-[13px] font-semibold">{t("prepare.invoice")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t("prepare.number")} value={form.invoiceNumber} onChange={(v) => set("invoiceNumber", v)} testId="v5-invoice-number" />
                <TextField label={t("prepare.date")} type="date" value={form.invoiceDate} onChange={(v) => set("invoiceDate", v)} testId="v5-invoice-date" />
                <label className="block sm:col-span-2">
                  <span className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-muted">{t("prepare.rate")}</span>
                    <span className="text-[11.5px] text-faint" data-testid="v5-rate-source">
                      {form.rateSource === "NBC" && form.rateDate ? t("prepare.rateNbc", { date: form.rateDate }) : t("prepare.rateManual")}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Input
                      inputMode="decimal"
                      value={form.rate}
                      onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value, rateSource: "MANUAL", rateDate: null }))}
                      aria-invalid={!rateValid || undefined}
                      className={`tnum text-right ${!rateValid ? "!border-danger" : ""}`}
                      data-testid="v5-rate-input"
                    />
                    <Button variant="secondary" onClick={() => void fetchRate()} disabled={fetching} className="shrink-0" data-testid="v5-fetch-rate">
                      {t("prepare.fetchNbc")}
                    </Button>
                  </span>
                </label>
                <label className="flex items-center gap-2.5 sm:col-span-2">
                  <Checkbox checked={form.vatApplicable} onChange={(value) => set("vatApplicable", value)} label={t("prepare.vat")} />
                  <span className="text-[13.5px]">{t("prepare.vat")}</span>
                </label>
              </div>
            </fieldset>
          </div>

          <div className="mt-7 grid gap-6 border-t border-line pt-5 sm:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0 space-y-1.5 text-[13px]">
              <p className="text-muted">{t("prepare.finalNote")}</p>
              {!form.vatin.trim() && <p className="text-pending" data-testid="v5-warn-vatin">{t("prepare.warnVatin")}</p>}
              {tooManyLines && <p className="text-danger">{t("prepare.errLines", { count: lines.length })}</p>}
              {errors.map((key) => (
                <p key={key} className="text-danger" data-testid="v5-prepare-error">{t(key)}</p>
              ))}
            </div>
            <dl className="tnum space-y-1.5 text-[13.5px]" data-testid="v5-totals">
              <Row label={t("prepare.subtotal")} value={moneyExact(totals.subtotalUsd)} testId="v5-subtotal" />
              <Row label={t("prepare.vatLine", { percent: totals.vatPercent })} value={moneyExact(totals.vatUsd)} testId="v5-vat" />
              <Row label={t("prepare.totalUsd")} value={moneyExact(totals.totalUsd)} strong testId="v5-total-usd" />
              <Row label={t("prepare.totalKhr")} value={rateValid ? khr(totals.totalKhr) : "—"} strong testId="v5-total-khr" />
            </dl>
          </div>
        </div>
      )}

      {mode === "preview" && (
        <div className="rounded-xl bg-fill p-3 sm:p-4" data-testid="v5-preview-sheet">
          <FitA4>
            <InvoiceDocument invoice={view} />
          </FitA4>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void issue()}
        busy={busy}
        title={t("prepare.confirmTitle")}
        message={t("prepare.confirmBody", { number: form.invoiceNumber, total: moneyExact(totals.totalUsd) })}
        confirmLabel={t("prepare.issue")}
        testId="v5-confirm-issue"
      />
    </Modal>
  );
}

function Row({ label, value, strong = false, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "text-[15px] font-semibold" : "font-medium"} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  testId,
  type = "text",
  lang,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  type?: string;
  lang?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      <Input type={type} value={value} lang={lang} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
    </label>
  );
}

/** Memo and the facts about the project, first thing in the sheet. */
function MemoAndDetails({ project, snapshot, clientName }: { project: BoardProject; snapshot: Snapshot; clientName: string }) {
  const t = useV5T();
  const row = snapshot.projects.find((candidate) => candidate.id === project.id);
  return (
    <div className="space-y-3">
      {project.note.trim() && (
        <div className="rounded-xl border border-line bg-fill px-4 py-3" data-testid="v5-memo">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{t("accounting.memo")}</p>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-text">{project.note}</p>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:flex sm:flex-wrap sm:gap-x-10" data-testid="v5-details">
        <Detail label={t("accounting.details")} value={clientName} />
        <Detail label={t("accounting.date")} value={row?.date ?? project.date} />
        <Detail label={t("accounting.lines", { count: project.items.length })} value={moneyExact(project.total)} />
      </dl>
    </div>
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

/** Final Total → Payments → Balance, with the one form that adds to it. */
function PaymentsPanel({
  project,
  snapshot,
  run,
}: {
  project: BoardProject;
  snapshot: Snapshot;
  run: ReturnType<typeof useAction>["run"];
}) {
  const t = useV5T();
  const { toast } = useToast();
  const { payments, result } = projectSettlement(project, snapshot);
  const [kind, setKind] = useState<ProjectPaymentKind>(result.paid > 0 ? "PARTIAL" : "DEPOSIT");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(phnomPenhDate());
  const value = Number(amount);
  const issues = amount.trim() ? validatePayment(value, result.balance) : [];

  const add = async () => {
    const ok = await run(() => api("/api/v5/payments", { method: "POST", body: { projectId: project.id, kind, amount: value, paidOn } }));
    if (ok) {
      setAmount("");
      setKind("PARTIAL");
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
        <h3 className="text-[13px] font-semibold">{t("payments.title")}</h3>
        <span className="text-[12px] text-faint">{t("balance.basis")}</span>
      </div>
      <dl className="tnum mt-3 grid grid-cols-3 gap-4 text-[13px] sm:max-w-md" data-testid="v5-balance">
        <Detail label={t("balance.final")} value={moneyExact(result.finalTotal)} />
        <Detail label={t("balance.paid")} value={moneyExact(result.paid)} />
        <div className="min-w-0">
          <dt className="text-[11.5px] text-muted">{t("balance.remaining")}</dt>
          <dd className="truncate text-[15px] font-semibold" data-testid="v5-balance-remaining">
            {moneyExact(result.balance)}
          </dd>
          <dd className="text-[11.5px] text-faint" data-testid="v5-balance-status">{t(`balance.status.${result.status}` as V5Key)}</dd>
        </div>
      </dl>

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
                <span className="min-w-0 flex-1 truncate">
                  {legacy ? t("payments.legacy") : t(`payments.kind.${payment.kind}` as V5Key)}
                </span>
                <span className="tnum shrink-0 font-medium">{moneyExact(payment.amount)}</span>
                {!legacy && !voided && (
                  <button type="button" onClick={() => void remove(payment.id)} className="shrink-0 text-[12.5px] text-muted hover:text-danger">
                    {t("payments.remove")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[10rem_8rem_10rem_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("payments.kind")}</span>
          <Select value={kind} onChange={(event) => setKind(event.target.value as ProjectPaymentKind)} data-testid="v5-payment-kind">
            {(["DEPOSIT", "PARTIAL", "FINAL"] as const).map((option) => (
              <option key={option} value={option}>{t(`payments.kind.${option}`)}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("payments.amount")}</span>
          <Input
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={hasErrors(issues) || undefined}
            className={`tnum text-right ${hasErrors(issues) ? "!border-danger" : ""}`}
            data-testid="v5-payment-amount"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("payments.date")}</span>
          <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} data-testid="v5-payment-date" />
        </label>
        <Button
          variant="secondary"
          onClick={() => void add()}
          disabled={!amount.trim() || hasErrors(issues)}
          className="col-span-2 sm:col-span-1 sm:justify-self-start"
          data-testid="v5-payment-add"
        >
          {t("payments.add")}
        </Button>
      </div>
      {issues.some((issue) => issue.code === "PAYMENT_EXCEEDS_BALANCE") && (
        <p className="mt-1.5 text-[12.5px] text-pending">{t("payments.exceeds")}</p>
      )}
    </section>
  );
}
