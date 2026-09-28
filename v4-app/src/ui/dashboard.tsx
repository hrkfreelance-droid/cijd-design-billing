"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { calculateBillingLine, projectBalance } from "@/domain/pricing";
import type { BillingItem, BootstrapData, Customer, FinalMode, Project, TaxInvoice } from "@/domain/types";
import { InvoiceDocument } from "@/ui/invoice-document";

type View = "billing" | "invoice" | "customers" | "records";
type Lang = "en" | "ja";
type Theme = "light" | "dark";

const emptyCustomer = {
  companyNameEn: "",
  companyNameKm: "",
  contactName: "",
  addressEn: "",
  addressKm: "",
  telephone: "",
  vatin: "",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v4${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Dashboard() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [view, setView] = useState<View>("billing");
  const [lang, setLang] = useState<Lang>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setData(await api<BootstrapData>("/bootstrap"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load V4 data");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  async function action(run: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
      await refresh();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>CIJD</span><small>BILLING V4 · ISOLATED</small></div>
        <nav>
          <Nav active={view === "billing"} onClick={() => setView("billing")}>{L(lang, "Billing", "請求管理")}</Nav>
          <Nav active={view === "invoice"} onClick={() => setView("invoice")}>{L(lang, "Tax Invoice", "Tax Invoice")}</Nav>
          <Nav active={view === "customers"} onClick={() => setView("customers")}>{L(lang, "Customers", "顧客")}</Nav>
          <Nav active={view === "records"} onClick={() => setView("records")}>{L(lang, "Records", "発行履歴")}</Nav>
        </nav>
        <div className="isolation-mark"><strong>V4 Preview</strong><span>Independent data boundary</span></div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">CIJD DESIGN OPERATIONS</p><h1>{title(view, lang)}</h1></div>
          <div className="display-controls"><button onClick={() => setLang(lang === "en" ? "ja" : "en")}>{lang === "en" ? "日本語" : "EN"}</button><button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Dark" : "Light"}</button></div>
          <div className="rate-chip">
            <span>NBC USD/KHR</span>
            <strong>{data?.exchangeRate?.rateKhrPerUsd.toLocaleString() ?? "Not loaded"}</strong>
            <button disabled={busy} onClick={() => action(() => api("/exchange-rate/refresh", { method: "POST" }), "NBC rate refreshed")}>Refresh</button>
          </div>
        </header>
        {notice && <p className="notice success">{notice}</p>}
        {error && <p className="notice error">{error}</p>}
        {!data ? <div className="loading">Loading isolated V4…</div> : (
          <>
            {view === "billing" && <BillingView data={data} busy={busy} action={action} lang={lang} />}
            {view === "invoice" && <InvoiceView data={data} busy={busy} action={action} lang={lang} />}
            {view === "customers" && <CustomerView data={data} busy={busy} action={action} lang={lang} />}
            {view === "records" && <RecordsView data={data} busy={busy} action={action} lang={lang} />}
          </>
        )}
      </main>
    </div>
  );
}

function Nav({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{children}</button>;
}

function title(view: View, lang: Lang) {
  return lang === "ja"
    ? { billing: "請求ワークスペース", invoice: "Tax Invoice", customers: "顧客マスター", records: "Tax Invoice履歴" }[view]
    : { billing: "Billing Workspace", invoice: "Tax Invoice", customers: "Customer Master", records: "Invoice Records" }[view];
}

function BillingView({ data, busy, action, lang }: ViewProps) {
  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? "");
  const [serviceType, setServiceType] = useState("Design");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [markup, setMarkup] = useState("");
  const [finalMode, setFinalMode] = useState<FinalMode>("AUTO");
  const [finalValue, setFinalValue] = useState("");
  const [readiness, setReadiness] = useState<BillingItem["readiness"]>("PENDING");
  const selectedProject = data.projects.find((entry) => entry.id === projectId);
  const projectItems = data.billingItems.filter((item) => item.projectId === projectId);
  const total = projectItems.reduce((sum, item) => sum + item.finalTotalUsd, 0);
  const balance = projectBalance(total, selectedProject?.depositUsd ?? 0);
  const preview = useMemo(() => {
    try {
      return calculateBillingLine({
        quantity: Number(quantity),
        unitCostUsd: unitCost === "" ? null : Number(unitCost),
        markupOverridePercent: markup === "" ? null : Number(markup),
        finalMode,
        currentFinalUnitUsd: finalMode === "UNIT" ? Number(finalValue) : null,
        currentFinalTotalUsd: finalMode === "TOTAL" ? Number(finalValue) : null,
      });
    } catch { return null; }
  }, [finalMode, finalValue, markup, quantity, unitCost]);

  async function save() {
    if (!projectId || !description.trim() || !preview) throw new Error("Complete the billing line before saving");
    await api("/billing-items", {
      method: "POST",
      body: JSON.stringify({
        projectId, serviceType, description: description.trim(), quantity: Number(quantity),
        unitCostUsd: unitCost === "" ? null : Number(unitCost), totalCostUsd: preview.totalCostUsd,
        markupOverridePercent: markup === "" ? null : Number(markup), recommendedTotalUsd: preview.recommendedTotalUsd,
        finalUnitUsd: preview.finalUnitUsd, finalTotalUsd: preview.finalTotalUsd, finalMode, readiness,
      }),
    });
    setDescription(""); setUnitCost(""); setMarkup(""); setFinalValue(""); setFinalMode("AUTO"); setReadiness("PENDING");
  }

  return (
    <section className="stack">
      <div className="card project-strip">
        <label>{L(lang, "Project", "案件")}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{L(lang, "Select project", "案件を選択")}</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.title}</option>)}</select></label>
        <Stat label={L(lang, "Final total", "最終合計")} value={money(balance.finalTotal)} />
        <Stat label={L(lang, "Deposit", "入金")} value={money(balance.deposit)} />
        <Stat label={L(lang, "Remaining", "残額")} value={money(balance.remaining)} accent />
      </div>
      <div className="two-column">
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">NEW LINE</p><h2>{L(lang, "Billing item", "請求明細")}</h2></div><span className="badge">{L(lang, "Manual & cost-based", "手動・原価ベース")}</span></div>
          <div className="form-grid">
            <label>Service type<select value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option>Design</option><option>Printing</option><option>Website</option><option>Manual</option></select></label>
            <label>Quantity<input type="number" min="0.0001" step="any" value={quantity} onChange={(event) => {
              if (finalMode === "TOTAL" && preview) {
                setFinalMode("UNIT");
                setFinalValue(String(preview.finalUnitUsd));
              }
              setQuantity(event.target.value);
            }} /></label>
            <label className="wide">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Item or service description" /></label>
            <label>Unit cost USD<input type="number" min="0" step="any" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="Optional for Manual" /></label>
            <label>Markup override %<input type="number" min="0" step="0.1" value={markup} onChange={(event) => setMarkup(event.target.value)} placeholder="50 / 40 / 30 automatic" /></label>
            <label>Final price mode<select value={finalMode} onChange={(event) => setFinalMode(event.target.value as FinalMode)}><option value="AUTO">Use Recommended</option><option value="UNIT">Manual Final Unit</option><option value="TOTAL">Manual Final Total</option></select></label>
            <label>Manual final {finalMode === "TOTAL" ? "total" : "unit"}<input disabled={finalMode === "AUTO"} type="number" min="0" step="any" value={finalValue} onChange={(event) => setFinalValue(event.target.value)} /></label>
            <label>Readiness<select value={readiness} onChange={(event) => setReadiness(event.target.value as BillingItem["readiness"])}><option value="PENDING">PENDING</option><option value="READY">READY</option></select></label>
          </div>
          <div className="calculation-bar"><span>Total Cost <strong>{preview?.totalCostUsd == null ? "—" : money(preview.totalCostUsd)}</strong></span><span>Recommended <strong>{preview?.recommendedTotalUsd == null ? "—" : money(preview.recommendedTotalUsd)}</strong></span><span>Final <strong>{preview ? money(preview.finalTotalUsd) : "—"}</strong></span></div>
          <div className="button-row"><button className="primary" disabled={busy} onClick={() => action(save, "Billing item saved")}>{L(lang, "Save billing item", "請求明細を保存")}</button>{finalMode !== "AUTO" && <button className="secondary" onClick={() => { setFinalMode("AUTO"); setFinalValue(""); }}>{L(lang, "Use Recommended", "推奨価格を使用")}</button>}</div>
        </section>
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">PROJECT LEDGER</p><h2>{L(lang, "Existing items", "登録済み明細")}</h2></div><span>{projectItems.length} items</span></div>
          <div className="item-list">{projectItems.length ? projectItems.map((item) => <BillingRow key={item.id} item={item} />) : <Empty>No billing items for this project.</Empty>}</div>
        </section>
      </div>
    </section>
  );
}

function BillingRow({ item }: { item: BillingItem }) {
  return <article className="item-row"><div><strong>{item.description}</strong><span>{item.serviceType} · Qty {item.quantity} · {item.finalMode}</span></div><div><b>{money(item.finalTotalUsd)}</b><span className={`status ${item.readiness.toLowerCase()}`}>{item.readiness}</span></div></article>;
}

function InvoiceView({ data, busy, action, lang }: ViewProps) {
  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [showPreview, setShowPreview] = useState(false);
  const ready = data.billingItems.filter((item) => item.projectId === projectId && item.readiness === "READY");
  const subtotal = ready.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.finalTotalUsd, 0);
  const vat = Math.round(subtotal * 10) / 100;
  const total = subtotal + vat;
  const project = data.projects.find((entry) => entry.id === projectId);
  const customer = data.customers.find((entry) => entry.id === project?.customerId);
  const previewLines = ready.filter((item) => selected.includes(item.id)).map((item, index) => ({ id: item.id, invoiceId: "preview", billingItemId: item.id, description: item.description, quantity: item.quantity, finalUnitUsd: item.finalUnitUsd, amountUsd: item.finalTotalUsd, sortOrder: index + 1 }));
  const previewInvoice: TaxInvoice | null = customer && previewLines.length ? {
    id: "preview", projectId, customerId: customer.id, status: "DRAFT", invoiceNumber: null, invoiceDate,
    customerSnapshot: { companyNameEn: customer.companyNameEn, companyNameKm: customer.companyNameKm, contactName: customer.contactName, addressEn: customer.addressEn, addressKm: customer.addressKm, telephone: customer.telephone, vatin: customer.vatin },
    exchangeRateKhr: data.exchangeRate?.rateKhrPerUsd ?? null, exchangeRateSource: data.exchangeRate?.source ?? null, exchangeRateEffectiveDate: data.exchangeRate?.effectiveDate ?? null,
    subtotalUsd: subtotal, vatPercent: 10, vatUsd: vat, totalUsd: total, totalKhr: data.exchangeRate ? Math.round(total * data.exchangeRate.rateKhrPerUsd) : null,
    issuedAt: null, cancelledAt: null, cancellationReason: null, createdAt: "", updatedAt: "", lines: previewLines,
  } : null;

  async function createDraft() {
    if (!projectId || !selected.length) throw new Error("Select at least one READY billing item");
    await api("/tax-invoices", { method: "POST", body: JSON.stringify({ projectId, invoiceDate, billingItemIds: selected }) });
    setSelected([]);
  }

  return (
    <section className="two-column invoice-builder">
      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">SOURCE ITEMS</p><h2>{L(lang, "Choose READY billing", "READY明細を選択")}</h2></div><span className="badge">{L(lang, "No double entry", "二重入力なし")}</span></div>
        <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelected([]); }}><option value="">Select project</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.title}</option>)}</select></label>
        <label>Invoice date<input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
        <div className="check-list">{ready.length ? ready.map((item) => <label key={item.id} className="check-row"><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><strong>{item.description}</strong><small>Qty {item.quantity} × {money(item.finalUnitUsd)}</small></span><b>{money(item.finalTotalUsd)}</b></label>) : <Empty>No READY items. Mark a billing item READY first.</Empty>}</div>
      </section>
      <section className="card summary-card">
        <p className="eyebrow">DRAFT TOTALS</p><h2>Tax Invoice</h2>
        <dl><div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div><div><dt>VAT 10%</dt><dd>{money(vat)}</dd></div><div className="grand"><dt>Total USD</dt><dd>{money(total)}</dd></div><div><dt>Total KHR</dt><dd>{data.exchangeRate ? `៛${Math.round(total * data.exchangeRate.rateKhrPerUsd).toLocaleString()}` : "Rate required"}</dd></div></dl>
        <p className="help">The customer, billing lines, VAT and NBC rate become immutable snapshots when issued.</p>
        <div className="button-row"><button className="primary" disabled={busy || !selected.length} onClick={() => action(createDraft, "Draft invoice created")}>{L(lang, "Save Draft", "下書き保存")}</button><button className="secondary" disabled={!previewInvoice} onClick={() => setShowPreview(true)}>{L(lang, "Preview A4", "A4プレビュー")}</button></div>
      </section>
      {showPreview && previewInvoice && <div className="preview-overlay"><div className="preview-toolbar"><strong>Excel template preview</strong><button onClick={() => setShowPreview(false)}>Close</button></div><div className="preview-canvas"><InvoiceDocument invoice={previewInvoice} /></div></div>}
    </section>
  );
}

function CustomerView({ data, busy, action, lang }: ViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyCustomer);
  const [projectCustomerId, setProjectCustomerId] = useState(data.customers[0]?.id ?? "");
  const [projectCode, setProjectCode] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [deposit, setDeposit] = useState("0");
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value }) });

  function edit(customer: Customer) {
    setEditingId(customer.id);
    setForm({ companyNameEn: customer.companyNameEn, companyNameKm: customer.companyNameKm, contactName: customer.contactName, addressEn: customer.addressEn, addressKm: customer.addressKm, telephone: customer.telephone, vatin: customer.vatin });
  }

  async function saveCustomer() {
    if (!form.companyNameEn && !form.companyNameKm) throw new Error("Customer name is required");
    await api(`/customers${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(form) });
    setEditingId(null); setForm(emptyCustomer);
  }

  async function saveProject() {
    if (!projectCustomerId || !projectCode || !projectTitle) throw new Error("Customer, code and project title are required");
    await api("/projects", { method: "POST", body: JSON.stringify({ customerId: projectCustomerId, code: projectCode, title: projectTitle, depositUsd: Number(deposit) }) });
    setProjectCode(""); setProjectTitle(""); setDeposit("0");
  }

  return (
    <section className="stack">
      <div className="two-column">
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">MASTER DATA</p><h2>{editingId ? L(lang, "Edit customer", "顧客を編集") : L(lang, "New customer", "新規顧客")}</h2></div>{editingId && <button className="text-button" onClick={() => { setEditingId(null); setForm(emptyCustomer); }}>{L(lang, "Cancel edit", "編集を取消")}</button>}</div>
          <div className="form-grid"><label>Company name (English)<input {...field("companyNameEn")} /></label><label>Company name (Khmer)<input {...field("companyNameKm")} /></label><label>Contact name<input {...field("contactName")} /></label><label>VATIN<input {...field("vatin")} /></label><label>Telephone<input {...field("telephone")} /></label><label className="wide">Address (English)<textarea {...field("addressEn")} /></label><label className="wide">Address (Khmer)<textarea {...field("addressKm")} /></label></div>
          <button className="primary" disabled={busy} onClick={() => action(saveCustomer, editingId ? "Customer updated" : "Customer created")}>{editingId ? L(lang, "Update customer", "顧客を更新") : L(lang, "Create customer", "顧客を作成")}</button>
        </section>
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">PROJECT</p><h2>New project</h2></div></div>
          <div className="form-grid"><label className="wide">Customer<select value={projectCustomerId} onChange={(event) => setProjectCustomerId(event.target.value)}><option value="">Select customer</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyNameEn || customer.companyNameKm}</option>)}</select></label><label>Project code<input value={projectCode} onChange={(event) => setProjectCode(event.target.value)} /></label><label>Deposit USD<input type="number" min="0" value={deposit} onChange={(event) => setDeposit(event.target.value)} /></label><label className="wide">Project title<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} /></label></div>
          <button className="primary" disabled={busy} onClick={() => action(saveProject, "Project created")}>{L(lang, "Create project", "案件を作成")}</button>
        </section>
      </div>
      <section className="card"><div className="section-heading"><div><p className="eyebrow">CUSTOMER MASTER</p><h2>{data.customers.length} customers</h2></div></div><div className="customer-grid">{data.customers.map((customer) => <article key={customer.id} className="customer-card"><strong>{customer.companyNameEn || customer.companyNameKm}</strong><span>{customer.companyNameKm}</span><small>{customer.vatin || "No VATIN"} · {customer.telephone || "No telephone"}</small><button onClick={() => edit(customer)}>Edit</button></article>)}</div></section>
    </section>
  );
}

function RecordsView({ data, busy, action, lang }: ViewProps) {
  async function issue(invoice: TaxInvoice) {
    if (!data.exchangeRate) throw new Error("Refresh NBC rate before issue");
    await api(`/tax-invoices/${invoice.id}/issue`, { method: "POST" });
  }
  async function cancel(invoice: TaxInvoice) {
    const reason = window.prompt("Cancellation reason");
    if (!reason) return;
    await api(`/tax-invoices/${invoice.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
  }
  return (
    <section className="card records-card">
      <div className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>{L(lang, "Tax invoices", "Tax Invoice履歴")}</h2></div><span>{data.invoices.length} records</span></div>
      <div className="records-table"><div className="record-head"><span>Invoice</span><span>Customer snapshot</span><span>Status</span><span>Total</span><span>Actions</span></div>{data.invoices.map((invoice) => <div className="record-row" key={invoice.id}><span><strong>{invoice.invoiceNumber ?? "Draft"}</strong><small>{invoice.invoiceDate}</small></span><span><strong>{invoice.customerSnapshot.companyNameEn || invoice.customerSnapshot.companyNameKm}</strong><small>{invoice.customerSnapshot.vatin}</small></span><span><i className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</i></span><span><strong>{money(invoice.totalUsd)}</strong><small>{invoice.totalKhr == null ? "—" : `៛${invoice.totalKhr.toLocaleString()}`}</small></span><span className="actions">{invoice.status === "DRAFT" && <button disabled={busy} onClick={() => action(() => issue(invoice), "Invoice issued")}>Issue</button>}{invoice.status === "ISSUED" && <button disabled={busy} onClick={() => action(() => cancel(invoice), "Invoice cancelled")}>Cancel</button>}<button disabled={busy} onClick={() => action(() => api(`/tax-invoices/${invoice.id}/duplicate`, { method: "POST" }), "Duplicated as Draft")}>Duplicate</button><a href={`/office-v4/tax-invoices/${invoice.id}/print`} target="_blank">Print / PDF</a></span></div>)}</div>
      {!data.invoices.length && <Empty>No invoices yet.</Empty>}
    </section>
  );
}

type ViewProps = { data: BootstrapData; busy: boolean; lang: Lang; action(run: () => Promise<unknown>, success: string): Promise<void> };
function L(lang: Lang, en: string, ja: string) { return lang === "ja" ? ja : en; }
function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`stat ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="empty">{children}</p>; }
