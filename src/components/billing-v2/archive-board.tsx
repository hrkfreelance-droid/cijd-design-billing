"use client";

import { useMemo, useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, ConfirmSheet, EmptyState, PageHeader } from "@/components/ui";
import { archiveBoard, boardTotal, type ArchiveProject } from "@/lib/billing-v2/board";
import { mediumDate, moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { Modal, ModalSection } from "./modal";

/**
 * Archive is a record, read the same way as Billing.
 *
 * Nothing is edited here — but an administrator can bring a project back to
 * Billing, where it becomes editable again, so no figure is ever stranded.
 */
export function ArchiveBoard({ snapshot, clientId }: { snapshot: Snapshot; clientId: string | null }) {
  const { t, locale } = useI18n();
  const { run, busy } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const groups = useMemo(() => archiveBoard(snapshot, clientId), [snapshot, clientId]);
  const total = boardTotal(groups);

  const projectsById = useMemo(() => {
    const map = new Map<string, { project: ArchiveProject; clientName: string }>();
    for (const group of groups) {
      for (const project of group.projects) {
        map.set(project.id, { project, clientName: group.client.name });
      }
    }
    return map;
  }, [groups]);

  const selected = open ? projectsById.get(open) : undefined;
  const pending = restoring ? projectsById.get(restoring) : undefined;

  const restore = async () => {
    if (!restoring) return;
    const projectId = restoring;
    setRestoring(null);
    const ok = await run(
      () => api("/api/billing-v2/restore", { method: "POST", body: { projectIds: [projectId] } }),
      { key: "v2.restore.done" },
    );
    if (ok) setOpen(null);
  };

  return (
    <div className="animate-rise pb-16">
      <PageHeader
        title={t("v2.archive.title")}
        subtitle={t("v2.archive.subtitle")}
        action={
          <span className="text-right">
            <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              {t("v2.total")}
            </span>
            <span className="tnum block text-[19px] font-semibold leading-tight tracking-[-0.02em]">
              {moneyExact(total)}
            </span>
          </span>
        }
      />

      {groups.length === 0 ? (
        <EmptyState title={t("v2.archive.empty")} />
      ) : (
        <div className="space-y-8 px-5 pb-8 sm:px-8">
          {groups.map((group) => (
            <section key={group.client.id} data-testid="v2-archive-group">
              <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
                <h2 className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.012em]">
                  {group.client.name}
                </h2>
                <span className="tnum shrink-0 text-[16px] font-semibold">
                  {moneyExact(group.total)}
                </span>
              </div>
              <ul>
                {group.projects.map((project) => (
                  <li
                    key={project.id}
                    className="border-b border-line"
                    data-testid="v2-archive-row"
                  >
                    <button
                      type="button"
                      onClick={() => setOpen(project.id)}
                      aria-label={t("v2.openProject", { name: project.name })}
                      className="flex w-full items-center gap-3 py-3 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
                          {project.name}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] text-muted">
                          {project.billedAt
                            ? t("v2.billedOn", { date: mediumDate(project.billedAt, locale) })
                            : t("v2.items", { count: project.items.length })}
                        </span>
                      </span>
                      <span className="tnum shrink-0 text-[15px]">{moneyExact(project.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected && (
        <Modal
          open
          onClose={() => setOpen(null)}
          kicker={selected.clientName}
          title={selected.project.name}
          subtitle={
            selected.project.billedAt
              ? t("v2.billedOn", { date: mediumDate(selected.project.billedAt, locale) })
              : undefined
          }
          closeLabel={t("common.close")}
          footer={
            <div className="flex items-center justify-between gap-4">
              <p className="min-w-0 text-[12.5px] text-muted">{t("v2.archive.readOnly")}</p>
              <Button
                onClick={() => setRestoring(selected.project.id)}
                disabled={busy}
                className="min-h-[46px]"
                data-testid="v2-restore"
              >
                {t("v2.restore")}
              </Button>
            </div>
          }
        >
          <ModalSection
            title={t("v2.lineItems")}
            meta={t("v2.items", { count: selected.project.items.length })}
          >
            <div className="border-t border-line">
              {selected.project.items.map((entry) => (
                <div
                  key={entry.item.id}
                  className="flex items-start justify-between gap-4 border-b border-line py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{entry.item.description}</span>
                    <span className="mt-0.5 block text-[12.5px] text-muted">
                      {t(entry.service.labelKey)} · {t("v2.quantity")} {entry.item.quantity}
                      {entry.item.printCost != null
                        ? ` · ${t("v2.cost")} ${moneyExact(entry.item.printCost)}`
                        : ""}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[15px] font-semibold">
                    {moneyExact(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-4 pt-4">
              <span className="text-[13.5px] text-muted">{t("v2.projectTotal")}</span>
              <span className="tnum text-[22px] font-semibold tracking-[-0.02em]">
                {moneyExact(selected.project.total)}
              </span>
            </div>
          </ModalSection>
        </Modal>
      )}

      <ConfirmSheet
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        onConfirm={restore}
        busy={busy}
        title={t("v2.restore.confirmTitle")}
        message={t("v2.restore.confirmBody", { name: pending?.project.name ?? "" })}
        confirmLabel={t("v2.restore")}
      />
    </div>
  );
}
