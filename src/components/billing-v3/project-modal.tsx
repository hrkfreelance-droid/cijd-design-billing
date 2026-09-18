"use client";

import { useState } from "react";

import { api, useData, useI18n, useToast } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, Input } from "@/components/ui";
import type { BoardProject } from "@/lib/billing-v2/board";
import { isCostPriced, serviceLabel } from "@/lib/billing-v2/services";
import { moneyExact } from "@/lib/format";
import type { ServiceType } from "@/lib/types";
import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { ItemEditor, ItemEditorHeader } from "./item-editor";
import {
  blankDraft,
  draftChanged,
  draftFromItem,
  draftIsComplete,
  draftPendingCount,
  draftService,
  draftTotal,
  type ItemDraft,
} from "./item-draft";
import { Modal } from "@/components/billing-v2/modal";
import { ProjectDetail, projectStatus } from "@/components/billing-v2/project-detail";
import { saveProject } from "./save-project";

type Confirm = "bill" | "delete" | null;

/**
 * A project, opened from the Billing list.
 *
 * It opens as a read-only detail. Edit turns the same sheet into a form; Save
 * writes, reloads and returns to the detail without closing; Cancel drops the
 * changes. The actions that move the project — ready, in progress, billed —
 * live in the detail's footer, so nothing needs a second screen.
 */
export function ProjectModal({
  project,
  clientName,
  serviceTypes = [],
  onClose,
}: {
  project: BoardProject;
  clientName: string;
  serviceTypes?: ServiceType[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { refresh } = useData();
  const { toast } = useToast();
  const { run, busy, describe } = useAction();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [name, setName] = useState(project.name);
  const [note, setNote] = useState(project.note);
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [wasReady, setWasReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const working = busy || saving;
  const ready = project.blocker === null;

  const startEditing = () => {
    setName(project.name);
    setNote(project.note);
    setDrafts(project.items.length ? project.items.map(draftFromItem) : [blankDraft()]);
    setWasReady(ready);
    setSaveError(null);
    setMode("edit");
  };

  const cancelEditing = () => {
    setSaveError(null);
    setMode("view");
  };

  const live = drafts.filter((draft) => !draft.removed);
  const total = draftTotal(drafts);
  const pending = draftPendingCount(drafts);
  const complete = name.trim() !== "" && drafts.every(draftIsComplete);
  const dirty =
    name.trim() !== project.name ||
    note.trim() !== project.note ||
    drafts.some((draft) => (draft.id ? draftChanged(draft) : true));

  const update = (key: string, next: ItemDraft) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? next : draft)));

  const remove = (target: ItemDraft) =>
    setDrafts((current) =>
      target.id
        ? current.map((draft) => (draft.key === target.key ? { ...draft, removed: true } : draft))
        : current.filter((draft) => draft.key !== target.key),
    );

  const save = async () => {
    if (saving || !complete || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveProject({
        projectId: project.id,
        name,
        note,
        originalName: project.name,
        originalNote: project.note,
        drafts: drafts.map((draft) => ({
          ...draft,
          description: draft.description.trim() || serviceLabel(draftService(draft, serviceTypes), t),
        })),
        serviceTypes,
        keepReady: wasReady,
        // Record each finished line, so a retry after a dropped connection
        // neither creates a line twice nor deletes one twice.
        onLineSaved: (key, item) =>
          setDrafts((current) =>
            item
              ? current.map((draft) => (draft.key === key ? { ...draft, id: item.id } : draft))
              : current.filter((draft) => draft.key !== key),
          ),
      });
      await refresh();
      setMode("view");
      toast(t("v2.saved"));
    } catch (error) {
      console.error("[billing-v2] save failed", error);
      setSaveError(`${t("v2.saveFailed")} ${describe(error) === t("error.generic") ? "" : describe(error)}`.trim());
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const setReadiness = (readiness: "READY" | "IN_PROGRESS") =>
    run(
      () => api(`/api/projects/${project.id}/readiness`, { method: "PATCH", body: { readiness } }),
      { key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done" },
    );

  const markBilled = async () => {
    const ok = await run(
      () => api("/api/billing-v2/billed", { method: "POST", body: { projectIds: [project.id] } }),
      { key: "v2.markBilled.done" },
    );
    setConfirm(null);
    if (ok) onClose();
  };

  const removeProject = async () => {
    const ok = await run(() => api(`/api/billing-v2/projects/${project.id}`, { method: "DELETE" }), {
      key: "v2.deleteProject.done",
    });
    setConfirm(null);
    if (ok) onClose();
  };

  const addService = async (serviceName: string): Promise<string | null> => {
    try {
      const created = await api<ServiceType>("/api/service-types", {
        method: "POST",
        body: { name: serviceName },
      });
      await refresh();
      toast(t("v2.serviceAdded"));
      return created.key;
    } catch (error) {
      toast(describe(error), "error");
      return null;
    }
  };

  const viewFooter = (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4" data-testid="v2-readiness-action">
      <div className="min-w-0 text-[12.5px] text-muted sm:flex-1">
        {ready ? (
          <button
            type="button"
            onClick={() => void setReadiness("IN_PROGRESS")}
            disabled={working}
            className="rounded-full py-1 text-[13px] font-medium text-muted transition-colors hover:text-text disabled:text-faint"
            data-testid="v2-move-in-progress"
          >
            {t("v2.moveInProgress")}
          </button>
        ) : project.pricePendingCount > 0 ? (
          <span className="text-pending">{t("v2.pricePendingHint")}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end [&>button]:h-auto [&>button]:min-h-10 [&>button]:min-w-0 [&>button]:py-1.5 [&>button]:leading-tight">
        <Button variant="secondary" onClick={startEditing} disabled={working} data-testid="v2-modal-edit">
          {t("v2.edit")}
        </Button>
        {ready ? (
          <Button variant="primary" onClick={() => setConfirm("bill")} disabled={working} data-testid="v2-detail-mark-billed">
            {t("v2.markBilled")}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => void setReadiness("READY")}
            disabled={working || project.items.length === 0 || project.pricePendingCount > 0}
            data-testid="v2-mark-ready"
          >
            {t("v2.markReady")}
          </Button>
        )}
      </div>
    </div>
  );

  const editFooter = (
    <div className="space-y-2">
      {saveError && (
        <p role="alert" className="text-[13px] text-danger" data-testid="v2-save-error">
          {saveError}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={cancelEditing} disabled={saving} data-testid="v2-modal-cancel">
          {t("common.cancel")}
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-4">
          <span className="min-w-0 text-right">
            <span className="block text-[11.5px] text-muted">
              {pending > 0 ? t("v2.pricePending", { count: pending }) : t("v2.projectTotal")}
            </span>
            <span className="tnum block text-[18px] font-semibold leading-tight tracking-[-0.02em]" data-testid="v2-modal-total">
              {moneyExact(total)}
            </span>
          </span>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={saving || !complete || !dirty}
            aria-busy={saving}
            data-testid="v2-modal-save"
          >
            {saving ? t("v2.saving") : t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      busy={working}
      kicker={clientName}
      title={project.name}
      subtitle={<span data-testid="v2-view-status">{projectStatus(project, t)}</span>}
      closeLabel={t("common.close")}
      footer={mode === "view" ? viewFooter : editFooter}
      testId="v2-project-modal"
    >
      {mode === "view" ? (
        <ProjectDetail project={project} />
      ) : (
        <div data-testid="v2-edit-mode">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("v2.projectName")}</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={!name.trim() || undefined}
                className={!name.trim() ? "!border-danger" : ""}
                disabled={saving}
                data-testid="v2-project-name"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("v2.note")}</span>
              <Input
                value={note}
                placeholder={t("v2.notePlaceholder")}
                onChange={(event) => setNote(event.target.value)}
                disabled={saving}
                data-testid="v2-project-note"
              />
            </label>
          </div>

          <h3 className="mb-2 mt-7 text-[13px] font-semibold">{t("v2.lineItems")}</h3>
          <ItemEditorHeader
            showCost={live.some((draft) => isCostPriced(draftService(draft, serviceTypes)))}
          />
          <div className="border-t border-line">
            {drafts.length === 0 ? (
              <p className="border-b border-line py-5 text-[13.5px] text-muted">{t("v2.noItemsEdit")}</p>
            ) : (
              drafts.map((draft, index) => (
                <ItemEditor
                  key={draft.key}
                  draft={draft}
                  index={index}
                  onChange={(next) => update(draft.key, next)}
                  onRemove={() => remove(draft)}
                  onRestore={() => update(draft.key, { ...draft, removed: false })}
                  onAddService={addService}
                  serviceTypes={serviceTypes}
                  disabled={saving}
                />
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => setDrafts((current) => [...current, blankDraft()])}
            disabled={saving}
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full text-[13.5px] font-medium text-accent transition-colors hover:underline disabled:text-faint"
            data-testid="v2-add-item"
          >
            <span aria-hidden className="text-[17px] leading-none">+</span>
            {t("v2.addService")}
          </button>

          <div className="mt-10 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setConfirm("delete")}
              disabled={saving}
              className="text-[13px] font-medium text-danger transition-opacity hover:opacity-80 disabled:opacity-40"
              data-testid="v2-delete-project"
            >
              {t("v2.deleteProject")}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm === "bill"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void markBilled()}
        busy={busy}
        title={t("v2.markBilled.confirmTitle")}
        message={
          <>
            <span className="block font-medium text-text">{project.name}</span>
            {t("v2.markBilled.confirmBody", { count: 1, total: moneyExact(project.total) })}
          </>
        }
        confirmLabel={t("v2.markBilled")}
        testId="v2-confirm-bill"
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void removeProject()}
        busy={busy}
        tone="destructive"
        title={t("v2.deleteProject")}
        message={t("v2.deleteProject.confirm", { name: project.name })}
        confirmLabel={t("v2.deleteProject")}
        testId="v2-confirm-delete"
      />
    </Modal>
  );
}

