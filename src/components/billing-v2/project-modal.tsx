"use client";

import { useMemo, useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, ConfirmSheet, Input } from "@/components/ui";
import { isCostPriced, serviceLabel } from "@/lib/billing-v2/services";
import type { BoardItem, BoardProject } from "@/lib/billing-v2/board";
import { moneyExact } from "@/lib/format";
import type { ServiceType } from "@/lib/types";
import { ItemEditor } from "./item-editor";
import {
  blankDraft,
  draftFromItem,
  draftIsComplete,
  draftTotal,
  type ItemDraft,
} from "./item-draft";
import { Modal, ModalSection } from "./modal";
import { saveProject } from "./save-project";

/**
 * A project, complete, in one place: what it is, what is on it, what it comes
 * to, and the single Save that writes it. Nothing here asks a second question
 * about an everyday number — only removing a line does.
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
  const { run, runResult, busy } = useAction();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [name, setName] = useState(project.name);
  const [note, setNote] = useState(project.note);
  const [drafts, setDrafts] = useState<ItemDraft[]>(() => project.items.map(draftFromItem));
  const [removing, setRemoving] = useState<ItemDraft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [serviceName, setServiceName] = useState("");

  const resetDraft = () => {
    setName(project.name);
    setNote(project.note);
    setDrafts(project.items.map(draftFromItem));
    setRemoving(null);
    setAddingService(false);
    setServiceName("");
    setMode("view");
  };

  const visible = drafts.filter((draft) => !draft.removed);
  const total = draftTotal(drafts);
  const complete = drafts.every(draftIsComplete);

  const dirty = useMemo(
    () =>
      name.trim() !== project.name ||
      note.trim() !== project.note ||
      drafts.some((draft) => draft.removed || !draft.id) ||
      drafts.some((draft) => {
        const before = draft.original;
        if (!before) return true;
        return (
          draft.description !== before.item.description ||
          Number(draft.quantity) !== before.item.quantity ||
          (draft.finalPrice.trim() ? Number(draft.finalPrice) : null) !== before.amount ||
          (draft.cost === "" ? null : Number(draft.cost)) !== (before.item.printCost ?? null) ||
          draft.serviceKey !== before.service.key
        );
      }),
    [drafts, name, note, project.name, project.note],
  );

  const update = (key: string, next: ItemDraft) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? next : draft)));

  const confirmRemove = () => {
    if (!removing) return;
    setDrafts((current) =>
      removing.id
        ? current.map((draft) =>
            draft.key === removing.key ? { ...draft, removed: true } : draft,
          )
        : current.filter((draft) => draft.key !== removing.key),
    );
    setRemoving(null);
  };

  const removeProject = async () => {
    setDeleting(false);
    const ok = await run(() => api(`/api/billing-v2/projects/${project.id}`, { method: "DELETE" }), {
      key: "v2.deleteProject.done",
    });
    if (ok) onClose();
  };

  const save = async () => {
    const ok = await run(
      () =>
        saveProject({
          projectId: project.id,
          name,
          note,
          originalName: project.name,
          originalNote: project.note,
          drafts,
          serviceTypes,
        }),
      { key: "v2.saved" },
    );
    if (ok) setMode("view");
  };

  const setReadiness = async (readiness: "READY" | "IN_PROGRESS") => {
    await run(
      () => api(`/api/projects/${project.id}/readiness`, { method: "PATCH", body: { readiness } }),
      { key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done" },
    );
  };

  const addService = async () => {
    const result = await runResult(
      () => api<ServiceType>("/api/service-types", { method: "POST", body: { name: serviceName.trim() } }),
      { key: "v2.saved" },
    );
    if (result) {
      setServiceName("");
      setAddingService(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        busy={busy}
        kicker={clientName}
        title={project.name}
        closeLabel={t("common.close")}
        footer={
          mode === "view" ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex min-w-0 items-center gap-2" data-testid="v2-readiness-action">
                {project.blocker === null ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void setReadiness("IN_PROGRESS")}
                    disabled={busy}
                    data-testid="v2-move-in-progress"
                  >
                    {t("v2.moveInProgress")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void setReadiness("READY")}
                    disabled={busy || visible.length === 0 || project.pricePendingCount > 0}
                    data-testid="v2-mark-ready"
                  >
                    {t("v2.markReady")}
                  </Button>
                )}
                {project.pricePendingCount > 0 && (
                  <span className="text-[12px] text-muted">
                    {t("v2.pricePending", { count: project.pricePendingCount })}
                  </span>
                )}
              </div>
              <Button
                variant="primary"
                onClick={() => setMode("edit")}
                data-testid="v2-modal-edit"
              >
                {t("v2.edit")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={resetDraft}
                data-testid="v2-modal-cancel"
              >
                {t("common.cancel")}
              </Button>
              <div className="ml-auto flex items-center gap-4">
                <span className="min-w-0">
                  <span className="block text-[12px] text-muted">{t("v2.projectTotal")}</span>
                  <span
                    className="tnum block text-[22px] font-semibold leading-tight tracking-[-0.02em]"
                    data-testid="v2-modal-total"
                  >
                    {moneyExact(total)}
                  </span>
                </span>
                <Button
                  variant="primary"
                  onClick={save}
                  disabled={busy || !complete || !dirty}
                  className="min-h-[46px]"
                  data-testid="v2-modal-save"
                >
                  {t("common.save")}
                </Button>
              </div>
            </div>
          )
        }
      >
        {mode === "view" ? (
          <ProjectDetailView project={project} />
        ) : (
          <>
            <ModalSection title={t("v2.project")}>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12.5px] font-medium text-muted">
                    {t("v2.projectName")}
                  </span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    data-testid="v2-project-name"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12.5px] font-medium text-muted">
                    {t("v2.note")}
                  </span>
                  <Input
                    value={note}
                    placeholder={t("v2.notePlaceholder")}
                    onChange={(event) => setNote(event.target.value)}
                    data-testid="v2-project-note"
                  />
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title={t("v2.lineItems")}
              meta={t("v2.items", { count: visible.length })}
              action={
                <button
                  type="button"
                  onClick={() => setAddingService(true)}
                  className="text-[12px] font-medium text-accent hover:underline"
                >
                  {t("v2.addService")}
                </button>
              }
            >
              {visible.length === 0 ? (
                <p className="border-t border-line py-5 text-[13.5px] text-muted">{t("v2.noItems")}</p>
              ) : (
                <div className="border-t border-line">
                  {visible.map((draft, index) => (
                    <ItemEditor
                      key={draft.key}
                      draft={draft}
                      index={index}
                      onChange={(next) => update(draft.key, next)}
                      onRemove={() => setRemoving(draft)}
                      serviceTypes={serviceTypes}
                    />
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setDrafts((current) => [...current, blankDraft()])}
                className="mt-3 text-[13.5px] font-medium text-accent transition-colors hover:underline"
                data-testid="v2-add-item"
              >
                {t("v2.addItem")}
              </button>
            </ModalSection>

            <div className="mt-8 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="text-[12.5px] text-faint transition-colors hover:text-review"
                data-testid="v2-delete-project"
              >
                {t("v2.deleteProject")}
              </button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={removeProject}
        busy={busy}
        title={t("v2.deleteProject")}
        message={t("v2.deleteProject.confirm", { name: project.name })}
        confirmLabel={t("v2.deleteProject")}
      />

      <Modal
        open={addingService}
        onClose={() => setAddingService(false)}
        busy={busy}
        title={t("v2.newService")}
        closeLabel={t("common.close")}
        footer={
          <Button variant="primary" full onClick={() => void addService()} disabled={busy || !serviceName.trim()}>
            {t("common.save")}
          </Button>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-muted">{t("v2.service")}</span>
          <Input
            autoFocus
            value={serviceName}
            placeholder={t("v2.newServicePlaceholder")}
            onChange={(event) => setServiceName(event.target.value)}
          />
        </label>
      </Modal>

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title={t("v2.removeItem")}
        message={t("v2.removeItem.confirm", { name: removing?.description || t("v2.description") })}
        confirmLabel={t("v2.removeItem")}
      />
    </>
  );
}

function ProjectDetailView({ project }: { project: BoardProject }) {
  const { t } = useI18n();
  const groups = project.items.reduce<{ service: BoardItem["service"]; items: BoardItem[] }[]>(
    (current, entry) => {
      const group = current.find((candidate) => candidate.service.key === entry.service.key);
      if (group) group.items.push(entry);
      else current.push({ service: entry.service, items: [entry] });
      return current;
    },
    [],
  );

  return (
    <div className="space-y-7" data-testid="v2-view-mode">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">
          <p
            className="text-[11px] font-medium uppercase tracking-[0.09em] text-faint"
            data-testid="v2-view-status"
          >
            {project.blocker === null ? t("v2.section.ready") : t("v2.section.inProgress")}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {t("v2.items", { count: project.items.length })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {t("v2.projectTotal")}
          </span>
          <span
            className="tnum block text-[25px] font-semibold leading-tight tracking-[-0.025em]"
            data-testid="v2-view-project-total"
          >
            {project.pricePendingCount > 0 ? "—" : moneyExact(project.total)}
          </span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-[13.5px] text-muted">{t("v2.noItems")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.service.key} data-testid={`v2-view-service-${group.service.key}`}>
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-faint">
                {serviceLabel(group.service, t)}
              </h3>
              <span className="tnum text-[14px] font-semibold">
                {group.items.some((entry) => entry.amount == null)
                  ? "—"
                  : moneyExact(group.items.reduce((sum, entry) => sum + entry.amount!, 0))}
              </span>
            </div>
            <div>
              {group.items.map((entry) => {
                const costPriced = isCostPriced(entry.service);
                return (
                  <div
                    key={entry.item.id}
                    className="border-b border-line py-4 last:border-b-0"
                    data-testid="v2-view-item"
                  >
                    <div className="flex items-start justify-between gap-4">
                          <p className="min-w-0 text-[15px] font-medium">
                            {entry.item.description.trim() || serviceLabel(entry.service, t)}
                          </p>
                      {!costPriced && (
                        <span className="tnum shrink-0 text-[15px] font-semibold">
                          {displayAmount(entry.amount)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] text-muted">
                      {t("v2.quantity")} {entry.item.quantity}
                    </p>
                    {costPriced ? (
                      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[12.5px]">
                        <dt className="text-muted">{t("v2.cost")}</dt>
                        <dd className="tnum text-right text-muted" data-testid={`v2-view-cost-${entry.item.id}`}>
                          {displayAmount(entry.item.printCost)}
                        </dd>
                        <dt className="text-muted">{t("v2.recommended")}</dt>
                        <dd
                          className="tnum text-right text-muted"
                          data-testid={`v2-view-recommended-${entry.item.id}`}
                        >
                          {displayAmount(entry.recommended)}
                        </dd>
                        <dt className="pt-1 font-medium text-text">{t("v2.finalPrice")}</dt>
                        <dd
                          className="tnum pt-1 text-right text-[15px] font-semibold text-text"
                          data-testid={`v2-view-final-${entry.item.id}`}
                        >
                          {displayAmount(entry.amount)}
                        </dd>
                      </dl>
                    ) : (
                      <div className="mt-2 flex items-center justify-between gap-4 text-[12.5px] text-muted">
                        <span>{t("v2.finalPrice")}</span>
                        <span className="tnum font-medium text-text">{displayAmount(entry.amount)}</span>
                      </div>
                    )}
                    {entry.manual && (
                      <p className="mt-2 text-[12px] text-muted">{t("v2.manual")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {project.pricePendingCount > 0 && (
        <p className="text-[12px] text-muted">{t("v2.pricePending", { count: project.pricePendingCount })}</p>
      )}

      {project.note.trim() && (
        <div className="border-t border-line pt-4" data-testid="v2-view-note">
          <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-faint">{t("v2.note")}</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{project.note}</p>
        </div>
      )}
    </div>
  );
}

function displayAmount(value: number | null | undefined): string {
  return value == null ? "—" : moneyExact(value);
}
