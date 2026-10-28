"use client";

import { useMemo, useRef, useState } from "react";

import { Modal } from "@/components/billing-v2/modal";
import { api, useI18n, useToast } from "@/components/providers";
import { Button, Checkbox, Input } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { selectableClients } from "@/lib/billing-v2/board";
import { useV5T } from "@/lib/billing-v5/i18n";
import { customerFor } from "@/lib/billing-v5/ontology";
import { moneyExact } from "@/lib/format";
import type { Customer, Product, Snapshot } from "@/lib/types";
import { CustomerDocuments } from "./customer-documents";
import { inspectPatentPdf, type PatentDraft } from "@/lib/billing-v5/patent-import-client";
import { normalizedTin } from "@/lib/billing-v5/patent-import";

/* ------------------------------------------------------------- customers */

/** Customer Master: every client, with the legal details invoices are addressed to. */
export function CustomerMaster({ snapshot }: { snapshot: Snapshot }) {
  const t = useV5T();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [patent, setPatent] = useState<PatentDraft | null>(null);
  const [patentError, setPatentError] = useState<string | null>(null);
  const [readingPatent, setReadingPatent] = useState(false);
  const patentInput = useRef<HTMLInputElement>(null);
  const clients = useMemo(() => {
    const all = [...selectableClients(snapshot.clients), ...snapshot.clients.filter((c) => !c.active && c.name !== "DAISHIN")];
    return all.map((client) => ({ client, customer: customerFor(snapshot, client.id) }));
  }, [snapshot]);
  const needle = query.trim().toLowerCase();
  const shown = clients.filter(({ client, customer }) =>
    !needle || [client.name, customer.customerCode, customer.companyNameEn, customer.companyNameKm, customer.vatin, customer.telephone, customer.email].some((v) => v.toLowerCase().includes(needle)),
  );

  const importPatent = async (file: File) => {
    setPatentError(null);
    setReadingPatent(true);
    try {
      const draft = await inspectPatentPdf(file);
      const duplicate = clients.find(({ customer }) => normalizedTin(customer.vatin) === normalizedTin(draft.candidate.tin));
      setPatent(draft);
      setEditing(duplicate?.client.id ?? "new");
    } catch (error) {
      setPatent(null);
      setPatentError(error instanceof Error ? error.message : "Unable to read the PDF.");
    } finally {
      setReadingPatent(false);
    }
  };

  return (
    <section className="pt-8" data-testid="v5-customers">
      <div className="flex flex-wrap gap-2 pb-4">
        <div className="min-w-[180px] flex-1"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("master.search")} aria-label={t("master.search")} data-testid="v5-customer-search" /></div>
        <Button variant="secondary" onClick={() => { setPatent(null); setEditing("new"); }} data-testid="v5-customer-new">+ {t("master.new")}</Button>
        <Button variant="secondary" onClick={() => patentInput.current?.click()} disabled={readingPatent} data-testid="v5-patent-import">{readingPatent ? t("patent.reading") : t("patent.import")}</Button>
        <input ref={patentInput} type="file" accept=".pdf,application/pdf" hidden data-testid="v5-patent-file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importPatent(file); }} />
      </div>
      {patentError && <p className="pb-3 text-[13px] text-danger" role="alert" data-testid="v5-patent-error">{patentError}</p>}
      {shown.length === 0 ? (
        <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("customer.empty")}</p>
      ) : (
        <ul className="border-t border-line-strong">
          {shown.map(({ client, customer }) => (
            <li key={client.id} className="border-b border-line">
              <button type="button" onClick={() => setEditing(client.id)} className="group grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 py-3 text-left" data-testid="v5-customer-row">
                <span className="tnum text-[13px] text-faint">{customer.customerCode || "—"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium group-hover:underline group-hover:underline-offset-4">{client.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {[customer.companyNameEn !== client.name ? customer.companyNameEn : "", customer.companyNameKm].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="text-right text-[12.5px] text-muted">
                  {customer.vatin || "—"}
                  {!client.active && <span className="block text-faint">{t("master.inactive")}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <CustomerSheet snapshot={snapshot} id={editing === "new" ? null : editing} patent={patent} onClose={() => { setEditing(null); setPatent(null); }} />}
    </section>
  );
}

function CustomerSheet({ snapshot, id, patent, onClose }: { snapshot: Snapshot; id: string | null; patent: PatentDraft | null; onClose: () => void }) {
  const t = useV5T();
  const { t: t3 } = useI18n();
  const { toast } = useToast();
  const { runResult, busy } = useAction();
  const [storedCustomerId, setStoredCustomerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const client = id ? snapshot.clients.find((c) => c.id === id) : undefined;
  const base = id ? customerFor(snapshot, id) : null;
  const [form, setForm] = useState({
    name: client?.name ?? patent?.candidate.enterpriseName ?? "",
    customerCode: base?.customerCode ?? "",
    companyNameEn: base?.companyNameEn ?? patent?.candidate.enterpriseName ?? "",
    companyNameKm: base?.companyNameKm ?? patent?.candidate.companyNameKm ?? "",
    addressEn: base?.addressEn ?? "",
    addressKm: base?.addressKm ?? patent?.candidate.addressKm ?? "",
    telephone: base?.telephone ?? "",
    vatin: base?.vatin ?? patent?.candidate.tin ?? "",
    contactPerson: base?.contactPerson ?? "",
    email: base?.email ?? "",
    active: client?.active ?? true,
  });
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.name.trim() !== "";

  // The code is not sent: the server assigns it and never changes it.
  const { customerCode: _code, ...editable } = form;
  void _code;
  const attachPatent = async (targetId: string) => {
    if (!patent) return;
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.set("file", patent.file);
      body.set("documentType", "PATENT_TAX");
      const response = await fetch(`/api/v5/customers/${targetId}/documents`, { method: "POST", body });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.message ?? "Patent PDF upload failed.");
      toast(t("patent.attached"));
      onClose();
    } catch (error) {
      // Customer creation may already have succeeded. Do not create another.
      setUploadError(error instanceof Error ? error.message : "Patent PDF upload failed. Customer has been saved.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (storedCustomerId) {
      await attachPatent(storedCustomerId);
      return;
    }
    const saved = await runResult(() =>
      id ? api<Customer>(`/api/v5/customers/${id}`, { method: "PATCH", body: editable }) : api<Customer>("/api/v5/customers", { method: "POST", body: editable }),
    );
    if (saved) {
      toast(t("master.saved"));
      if (patent) {
        setStoredCustomerId(saved.id);
        await attachPatent(saved.id);
      } else {
        onClose();
      }
    }
  };

  const field = (key: Exclude<keyof typeof form, "active">, label: string, lang?: string) => (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      <Input value={form[key] as string} lang={lang} onChange={(event) => set(key, event.target.value)} data-testid={`v5-customer-${key}`} />
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy || uploading}
      kicker={form.customerCode || undefined}
      title={id ? form.name || t("customer.newTitle") : t("customer.newTitle")}
      closeLabel={t3("common.close")}
      testId="v5-customer-sheet"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy || uploading}>{t3("common.cancel")}</Button>
          {id && patent && <Button variant="secondary" onClick={() => void attachPatent(id)} disabled={busy || uploading} data-testid="v5-patent-attach-existing">{t("patent.attach")}</Button>}
          <Button variant="primary" onClick={() => void save()} disabled={!valid || busy || uploading} data-testid="v5-customer-save">{storedCustomerId ? t("patent.retry") : t3("common.save")}</Button>
        </div>
      }
    >
      {patent && (
        <div className="mb-5 border-b border-line pb-4 text-[12.5px]" data-testid="v5-patent-review">
          <p className="font-semibold">{t("patent.review")}</p>
          <p className="mt-1 break-all text-muted">{patent.file.name}</p>
          <p className="mt-1">{patent.candidate.enterpriseName} · {patent.candidate.tin} · {patent.candidate.patentYear || t("patent.unknownYear")}</p>
          <p className="mt-1 text-muted">{t("patent.owner")}: {patent.candidate.ownerName || t("patent.missingOwner")}</p>
          <p className="mt-1 text-muted">{id ? t("patent.matched") : t("patent.newNote")}</p>
        </div>
      )}
      {uploadError && <p className="mb-4 text-[12.5px] text-danger" role="alert" data-testid="v5-patent-upload-error">{t("patent.uploadFailed")} {uploadError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", t("customer.name"))}
        <div className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("master.code")}</span>
          {/* System-assigned, never typed or changed. */}
          <span className="tnum flex h-11 items-center text-[15px] text-muted" data-testid="v5-customer-code">{form.customerCode || t("customer.codeAuto")}</span>
        </div>
        {field("companyNameEn", t("prepare.nameEn"))}
        {field("companyNameKm", t("prepare.nameKm"), "km")}
        {field("addressEn", t("prepare.addressEn"))}
        {field("addressKm", t("prepare.addressKm"), "km")}
        {field("telephone", t("prepare.phone"))}
        {field("vatin", t("prepare.vatin"))}
        {field("contactPerson", t("customer.contact"))}
        {field("email", t("customer.email"))}
        <label className="flex items-center gap-2.5 sm:col-span-2">
          <Checkbox checked={form.active} onChange={(value) => set("active", value)} label={t("master.active")} />
          <span className="text-[13.5px]">{t("master.active")}</span>
        </label>
      </div>
      {id ? <CustomerDocuments customerId={id} /> : <p className="mt-6 text-[12.5px] text-faint">{t("docs.afterSave")}</p>}
    </Modal>
  );
}

/* -------------------------------------------------------------- products */

export function ProductMaster({ snapshot }: { snapshot: Snapshot }) {
  const t = useV5T();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const products = [...(snapshot.products ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.productCode.localeCompare(b.productCode));
  const needle = query.trim().toLowerCase();
  const shown = products.filter((p) => !needle || [p.productCode, p.description, p.unit].some((v) => v.toLowerCase().includes(needle)));

  return (
    <section className="pt-8" data-testid="v5-products">
      <div className="flex gap-2 pb-4">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("master.search")} aria-label={t("master.search")} data-testid="v5-product-search" />
        <Button variant="secondary" onClick={() => setEditing("new")} data-testid="v5-product-new">+ {t("master.new")}</Button>
      </div>
      {shown.length === 0 ? (
        <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("product.empty")}</p>
      ) : (
        <ul className="border-t border-line-strong">
          {shown.map((product) => (
            <li key={product.id} className="border-b border-line">
              <button type="button" onClick={() => setEditing(product.id)} className={`group grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 py-3 text-left ${product.active ? "" : "opacity-60"}`} data-testid="v5-product-row">
                <span className="tnum text-[13px] text-faint">{product.productCode}</span>
                <span className="min-w-0 truncate text-[14.5px] font-medium group-hover:underline group-hover:underline-offset-4">{product.description}</span>
                <span className="tnum text-right text-[13px] text-muted">
                  {product.defaultUnitPrice == null ? "—" : moneyExact(product.defaultUnitPrice)}
                  {product.unit && <span className="text-faint"> / {product.unit}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ProductSheet product={editing === "new" ? null : products.find((p) => p.id === editing) ?? null} onClose={() => setEditing(null)} />}
    </section>
  );
}

function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const t = useV5T();
  const { t: t3 } = useI18n();
  const { toast } = useToast();
  const { runResult, busy } = useAction();
  const [form, setForm] = useState({
    productCode: product?.productCode ?? "",
    description: product?.description ?? "",
    defaultUnitPrice: product?.defaultUnitPrice == null ? "" : String(product.defaultUnitPrice),
    unit: product?.unit ?? "",
    active: product?.active ?? true,
  });
  const price = form.defaultUnitPrice.trim() === "" ? null : Number(form.defaultUnitPrice);
  const valid = form.description.trim() !== "" && (price === null || (Number.isFinite(price) && price >= 0));

  const save = async () => {
    const body = { productCode: form.productCode, description: form.description, defaultUnitPrice: price, unit: form.unit, active: form.active };
    const saved = await runResult(() =>
      product ? api<Product>(`/api/v5/products/${product.id}`, { method: "PATCH", body }) : api<Product>("/api/v5/products", { method: "POST", body }),
    );
    if (saved) {
      toast(t("master.saved"));
      onClose();
    }
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      busy={busy}
      kicker={form.productCode || undefined}
      title={product ? product.description : t("product.newTitle")}
      closeLabel={t3("common.close")}
      testId="v5-product-sheet"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t3("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!valid || busy} data-testid="v5-product-save">{t3("common.save")}</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("product.description")}</span>
          <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} data-testid="v5-product-description" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("product.price")}</span>
          <Input inputMode="decimal" value={form.defaultUnitPrice} onChange={(event) => setForm({ ...form, defaultUnitPrice: event.target.value })} className="tnum text-right" data-testid="v5-product-price" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("product.unit")}</span>
          <Input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} data-testid="v5-product-unit" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("master.code")}</span>
          <Input value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })} data-testid="v5-product-code" />
        </label>
        <label className="flex items-center gap-2.5 self-end pb-3">
          <Checkbox checked={form.active} onChange={(value) => setForm({ ...form, active: value })} label={t("master.active")} />
          <span className="text-[13.5px]">{t("master.active")}</span>
        </label>
      </div>
    </Modal>
  );
}
