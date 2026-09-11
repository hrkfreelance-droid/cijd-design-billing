"use client";

import { useMemo, useState } from "react";

import { api, useI18n, useSession } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { archiveBoard, boardTotal, type ArchiveProject } from "@/lib/billing-v2/board";
import { serviceLabel } from "@/lib/billing-v2/services";
import { mediumDate, moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Modal } from "./modal";
import { Price, ProjectDetail } from "./project-detail";

/**
 * Archive is a plain record of what was billed: client, project, services,
 * final amount and the day it was billed. Nothing is edited here; a project
 * can be brought back to Billing, where it becomes editable again.
 */
export function ArchiveBoard({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const { run, busy } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const groups = useMemo(() => archiveBoard(snapshot), [snapshot]);
  const total = boardTotal(groups);
  const count = groups.reduce((sum, group) => sum + group.projects.length, 0);
  const canRestore = !!user && can(user.role, "invoice:write");

  const lookup = useMemo(() => {
    const map = new Map<string, { project: ArchiveProject; clientName: string }>();
    for (const group of groups) {
      for (const project of group.projects) map.set(project.id, { project, clientName: group.client.name });
    }
    return map;
  }, [groups]);

  const selected = open ? lookup.get(open) : undefined;

  const restore = async () => {
    if (!selected) return;
    const ok = await run(
      () => api("/api/billing-v2/restore", { method: "POST", body: { projectIds: [selected.project.id] } }),
      { key: "v2.restore.done" },
    );
    setRestoring(false);
    if (ok) setOpen(null);
  };

  const billedOn = (project: ArchiveProject) =>
    project.billedAt ? t("v2.billedOn", { date: mediumDate(project.billedAt, locale) }) : t("v2.billed");

  return (
    <div className="pb-16">
      <header className="px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] sm:text-[30px]">
          {t("v2.archive.title")}
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">{t("v2.archive.subtitle")}</p>
        {count > 0 && (
          <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-3">
            <div>
              <dt className="text-[11.5px] text-muted">{t("v2.billed")}</dt>
              <dd className="tnum mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]" data-testid="v2-archive-total">
                {moneyExact(total)}
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-muted">{t("v2.project")}</dt>
              <dd className="mt-0.5 text-[17px] font-medium leading-tight text-text/85">
                {t("v2.projects", { count })}
              </dd>
            </div>
          </dl>
        )}
      </header>

      {groups.length === 0 ? (
        <p className="px-5 py-16 text-center text-[14px] text-muted sm:px-8">{t("v2.archive.empty")}</p>
      ) : (
        <div className="px-5 pt-6 sm:px-8">
          {groups.map((group) => (
            <section key={group.client.id} className="pt-3" data-testid="v2-archive-group">
              <div className="flex items-baseline justify-between gap-4 border-b border-line-strong py-2.5">
                <h2 className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.012em]">{group.client.name}</h2>
                <span className="tnum shrink-0 text-[15px] font-semibold">{moneyExact(group.total)}</span>
              </div>
              <ul>
                {group.projects.map((project) => (
                  <li key={project.id} className="border-b border-line" data-testid="v2-archive-row">
                    <button
                      type="button"
                      onClick={() => setOpen(project.id)}
                      aria-label={t("v2.openProject", { name: project.name })}
                      className="group flex w-full items-baseline gap-4 py-3.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium leading-snug tracking-[-0.01em] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                          {project.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                          {billedOn(project)}
                          {" · "}
                          {Array.from(new Set(project.items.map((entry) => serviceLabel(entry.service, t)))).join(", ")}
                        </span>
                      </span>
                      <Price value={project.total} className="shrink-0 text-[15px]" />
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
          busy={busy}
          kicker={selected.clientName}
          title={selected.project.name}
          subtitle={billedOn(selected.project)}
          closeLabel={t("common.close")}
          testId="v2-archive-modal"
          footer={
            canRestore ? (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setRestoring(true)} disabled={busy} data-testid="v2-restore">
                  {t("v2.restore")}
                </Button>
              </div>
            ) : undefined
          }
        >
          <ProjectDetail project={selected.project} />
          <ConfirmDialog
            open={restoring}
            onClose={() => setRestoring(false)}
            onConfirm={() => void restore()}
            busy={busy}
            title={t("v2.restore.confirmTitle")}
            message={t("v2.restore.confirmBody", { name: selected.project.name })}
            confirmLabel={t("v2.restore")}
            testId="v2-confirm-restore"
          />
        </Modal>
      )}
    </div>
  );
}
