"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/providers";
import { Button, Input, Select } from "@/components/ui";
import type { CustomerDocument, DocumentType } from "@/lib/billing-v5/documents";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";

const TYPES: DocumentType[] = ["PATENT_TAX", "VAT_CERTIFICATE", "COMPANY_REGISTRATION", "BUSINESS_LICENSE", "OTHER"];
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.bmp,application/pdf,image/*";

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; message?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "Request failed");
  return payload.data as T;
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * A customer's company documents (internal only — never on a Tax Invoice).
 * Upload, view, download and replace; separate from saving the customer, so
 * a failed upload leaves the Customer Master as it was.
 */
export function CustomerDocuments({ customerId }: { customerId: string }) {
  const t = useV5T();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<CustomerDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<DocumentType>("PATENT_TAX");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<CustomerDocument | null>(null);

  // Bumped after an upload to read the list again.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    send<CustomerDocument[]>(`/api/v5/customers/${customerId}/documents`)
      .then((list) => {
        if (!live) return;
        setDocuments(list);
        setLoadError(null);
      })
      .catch((reason) => live && setLoadError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      live = false;
    };
  }, [customerId, version]);

  const upload = async (file: File, documentType: DocumentType, replacesId: string | null) => {
    const form = new FormData();
    form.set("file", file);
    form.set("documentType", documentType);
    if (memo.trim()) form.set("memo", memo.trim());
    if (replacesId) form.set("replacesId", replacesId);
    setBusy(true);
    setError(null);
    try {
      await send<CustomerDocument>(`/api/v5/customers/${customerId}/documents`, { method: "POST", body: form });
      setMemo("");
      toast(t(replacesId ? "docs.replaced" : "docs.uploaded"));
      setVersion((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const current = (documents ?? []).filter((doc) => !doc.replacedAt);
  const earlier = (documents ?? []).filter((doc) => doc.replacedAt);
  const typeLabel = (value: string) => t(`docs.type.${value}` as V5Key);

  return (
    <section className="mt-6 border-t border-line pt-5" data-testid="v5-customer-documents">
      <h3 className="text-[13px] font-semibold">{t("docs.title")}</h3>
      <p className="mt-0.5 text-[12px] text-faint">{t("docs.internal")}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
        <Select value={type} onChange={(event) => setType(event.target.value as DocumentType)} aria-label={t("docs.type")} data-testid="v5-doc-type">
          {TYPES.map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}
        </Select>
        <Input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder={t("docs.memo")} aria-label={t("docs.memo")} data-testid="v5-doc-memo" />
        <Button variant="secondary" onClick={() => uploadInput.current?.click()} disabled={busy} data-testid="v5-doc-upload">{busy ? t("docs.uploading") : t("docs.upload")}</Button>
      </div>
      <input
        ref={uploadInput}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="v5-doc-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file, type, null);
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="v5-doc-replace-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const target = replacing;
          setReplacing(null);
          if (file && target) void upload(file, target.documentType, target.id);
        }}
      />
      {error && <p className="mt-2 text-[12.5px] text-danger" data-testid="v5-doc-error">{error}</p>}

      {loadError ? (
        <p className="mt-3 text-[12.5px] text-danger" data-testid="v5-doc-load-error">{loadError}</p>
      ) : documents === null ? (
        <p className="mt-3 text-[12.5px] text-muted">…</p>
      ) : current.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted" data-testid="v5-doc-empty">{t("docs.empty")}</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {current.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2.5 text-[13px]" data-testid="v5-doc-row">
              <span className="font-medium">{typeLabel(doc.documentType)}</span>
              <span className="min-w-0 flex-1 truncate text-muted" data-testid="v5-doc-name">{doc.originalFileName}</span>
              <span className="text-[12px] text-faint">{doc.uploadedAt.slice(0, 10)} · {size(doc.sizeBytes)}{doc.memo ? ` · ${doc.memo}` : ""}</span>
              <span className="flex gap-3">
                <a href={`/api/v5/customer-documents/${doc.id}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" data-testid="v5-doc-view">{t("docs.view")}</a>
                <a href={`/api/v5/customer-documents/${doc.id}?download=1`} download={doc.originalFileName} className="text-accent hover:underline" data-testid="v5-doc-download">{t("docs.download")}</a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setReplacing(doc);
                    replaceInput.current?.click();
                  }}
                  className="text-accent hover:underline disabled:opacity-50"
                  data-testid="v5-doc-replace"
                >
                  {t("docs.replace")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <details className="mt-2 text-[12.5px] text-muted" data-testid="v5-doc-history">
          <summary className="cursor-pointer">{t("docs.earlier", { count: earlier.length })}</summary>
          <ul className="mt-1">
            {earlier.map((doc) => (
              <li key={doc.id} className="flex gap-3 py-1">
                <span>{typeLabel(doc.documentType)}</span>
                <span className="min-w-0 flex-1 truncate">{doc.originalFileName}</span>
                <span>{doc.uploadedAt.slice(0, 10)}</span>
                <a href={`/api/v5/customer-documents/${doc.id}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{t("docs.view")}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
