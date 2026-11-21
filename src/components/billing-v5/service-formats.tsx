"use client";

import Link from "next/link";
import { useState } from "react";
import { api, useData, useI18n, useToast } from "@/components/providers";
import { Button, Input, Select } from "@/components/ui";
import { Modal } from "@/components/billing-v2/modal";
import { useAction } from "@/components/use-action";
import { serviceDefinitionForKey, serviceLabel, serviceOptions } from "@/lib/billing-v2/services";
import { useSuggestionT } from "@/lib/billing-v5/suggestion-i18n";
import { matchesSearch, normalizeSearch } from "@/lib/billing-v5/project-view";
import { moneyExact } from "@/lib/format";
import type { ServiceFormat } from "@/lib/types";
import { useServiceSuggestions } from "./workspace-shell";
import { BILLING, WorkspaceHeading } from "./workspace-parts";

export function ServiceFormatsPage() {
  const index = useServiceSuggestions();
  const t = useSuggestionT();
  const [editing, setEditing] = useState<ServiceFormat | "new" | null>(null);
  const [query, setQuery] = useState("");
  const formats = index?.formats.filter((format) => matchesSearch(normalizeSearch(`${format.name} ${format.description} ${format.unit}`), query)) ?? [];
  return <div className="bw-page ss-page" data-testid="v5-service-formats">
    <WorkspaceHeading title={t("manage")} actions={<Button variant="primary" onClick={() => setEditing("new")}>{t("new")}</Button>} />
    <Link className="bw-text-link" href={BILLING}>← CIJD Billing</Link>
    <p className="ss-help">{t("help")}</p>
    <input className="bw-input ss-format-search" type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={(event) => setQuery(event.target.value)} />
    <p className="ss-help">{formats.length} {t("formats")}</p>
    <ul className="ss-formats">{formats.map((format) => <li key={format.id}>
      <button type="button" onClick={() => setEditing(format)} aria-label={`${t("edit")} ${format.name} ${format.description}`}>
        <div><strong>{format.name}</strong><small>{format.description} · {format.quantity} {format.unit}</small></div>
        <div><span className="tnum">{format.defaultUnitPrice === null ? t("unknown") : moneyExact(format.defaultUnitPrice)}</span>
          <small>{format.updatedAt ? t("manual") : `${format.sampleCount ?? 0} ${t("uses")}`}{!format.active && ` · ${t("inactive")}`}</small></div>
      </button>
    </li>)}</ul>
    {editing && <FormatEditor key={editing === "new" ? "new" : editing.id} format={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
  </div>;
}

function FormatEditor({ format, onClose }: { format: ServiceFormat | null; onClose: () => void }) {
  const t = useSuggestionT();
  const { t: common } = useI18n();
  const { snapshot } = useData();
  const { toast } = useToast();
  const { busy, runResult } = useAction();
  const [form, setForm] = useState({ name: format?.name ?? "", description: format?.description ?? "", serviceKey: format?.serviceKey ?? "DESIGN",
    unit: format?.unit ?? "", quantity: String(format?.quantity ?? 1), price: format?.defaultUnitPrice == null ? "" : String(format.defaultUnitPrice), active: format?.active ?? true });
  const price = form.price.trim() ? Number(form.price) : null;
  const valid = Boolean(form.name.trim() && form.description.trim() && Number(form.quantity) > 0 && Number.isFinite(Number(form.quantity)) && (price === null || Number.isFinite(price) && price >= 0));
  const available = serviceOptions(snapshot?.serviceTypes ?? []);
  const options = available.some((service) => service.key === form.serviceKey) ? available : [serviceDefinitionForKey(form.serviceKey, snapshot?.serviceTypes), ...available];
  const save = async () => {
    const saved = await runResult(() => api<ServiceFormat>("/api/v5/service-formats", { method: "POST", body: {
      ...(format ? { id: format.id } : {}), name: form.name, description: form.description, serviceKey: form.serviceKey,
      quantity: Number(form.quantity), unit: form.unit, defaultUnitPrice: price, active: form.active,
    } }));
    if (saved) { toast(t("saved")); onClose(); }
  };
  return <Modal open busy={busy} onClose={onClose} size="sm" title={format ? format.name : t("new")} closeLabel={common("common.close")} testId="v5-format-editor"
    footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>{common("common.cancel")}</Button>
      <Button variant="primary" onClick={() => void save()} disabled={busy || !valid} data-testid="v5-format-save">{common("common.save")}</Button></div>}>
    <div className="ss-format-form">
      {(["name", "description", "unit", "quantity", "price"] as const).map((key) => <label key={key}><span>{t(key)}</span>
        <Input value={form[key]} inputMode={key === "price" || key === "quantity" ? "decimal" : "text"} maxLength={key === "description" ? 2000 : key === "unit" ? 50 : 200}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })} disabled={busy} data-testid={`v5-format-${key}`} /></label>)}
      <label><span>{t("service")}</span><Select value={form.serviceKey} disabled={busy} onChange={(event) => setForm({ ...form, serviceKey: event.target.value })}>
        {options.map((service) => <option key={service.key} value={service.key}>{serviceLabel(service, common)}</option>)}
      </Select></label>
      <label className="ss-active"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} disabled={busy} /><span>{t("active")}</span></label>
    </div>
  </Modal>;
}
