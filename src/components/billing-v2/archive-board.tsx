"use client";

import { useMemo, useState } from "react";

import { HistoricalRecordRow } from "@/components/historical-record-row";
import { api, useI18n, useSession } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { archiveBoard, boardTotal, type ArchiveProject } from "@/lib/billing-v2/board";
import { serviceLabel } from "@/lib/billing-v2/services";
import { mediumDate, moneyExact } from "@/lib/format";
import { groupHistoricalItems } from "@/lib/historical";
import type { Client, Snapshot } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Modal } from "./modal";
import { Price, ProjectDetail } from "./project-detail";

type ArchiveEntry = {
  project: ArchiveProject;
  client: Client;
};

type ArchiveDateGroup = {
  date: string | null;
  entries: ArchiveEntry[];
  total: number;
};

/**
 * Archive keeps both kinds of reference material in one place:
 *
 * - current V2 work is grouped by the exact day it was billed;
 * - imported historical work remains read-only and keeps only the date facts
 *   that actually exist (often a month, sometimes no date at all).
 *
 * Search covers both, so old work can be used as a pricing reference without
 * turning historical evidence back into active billing data.
 */
export function ArchiveBoard({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const { run, busy } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => archiveBoard(snapshot), [snapshot]);
  const historical = useMemo(
    () =>
      groupHistoricalItems(
        snapshot.billingItems,
        new Map(snapshot.projects.map((project) => [project.id, project])),
        new Map(snapshot.clients.map((client) => [client.id, client])),
      ),
    [snapshot],
  );

  const total = boardTotal(groups);
  const count = groups.reduce((sum, group) => sum + group.projects.length, 0);
  const canRestore = !!user && can(user.role, "invoice:write");
  const term = query.trim().toLocaleLowerCase();

  const lookup = useMemo(() => {
    const map = new Map<string, { project: ArchiveProject; clientName: string }>();
    for (const group of groups) {
      for (const project of group.projects) map.set(project.id, { project, clientName: group.client.name });
    }
    return map;
  }, [groups]);

  const dateGroups = useMemo<ArchiveDateGroup[]>(() => {
    const byDate = new Map<string, ArchiveEntry[]>();

    for (const group of groups) {
      for (const project of group.projects) {
        if (term) {
          const services = project.items.map((entry) => serviceLabel(entry.service, t));
          const itemFacts = project.items.flatMap((entry) => [
            entry.item.description,
            entry.item.printSize ?? "",
            entry.item.note ?? "",
            ...services,
          ]);
          const searchable = [group.client.name, project.name, project.note, ...itemFacts]
            .join(" ")
            .toLocaleLowerCase();
          if (!searchable.includes(term)) continue;
        }

        const key = project.billedAt ?? "";
        const list = byDate.get(key);
        const entry = { project, client: group.client };
        if (list) list.push(entry);
        else byDate.set(key, [entry]);
      }
    }

    return Array.from(byDate, ([date, entries]) => ({
      date: date || null,
      entries: entries.sort(
        (a, b) => a.client.name.localeCompare(b.client.name) || a.project.name.localeCompare(b.project.name),
      ),
      total: boardTotal(entries.map((entry) => entry.project)),
    })).sort((a, b) => {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return b.date.localeCompare(a.date);
    });
  }, [groups, term, t]);

  const historicalRows = useMemo(() => {
    if (!term) return historical;
    return historical.filter((group) => {
      const searchable = [
        group.client.name,
        group.project.name,
        group.project.note ?? "",
        ...group.months,
        ...group.items.flatMap((item) => [
          item.description,
          item.note ?? "",
          item.printSize ?? "",
          item.amount == null ? "" : String(item.amount),
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(term);
    });
  }, [historical, term]);

  const selected = open ? lookup.get(open) : undefined;
  const hasRecords = groups.length > 0 || historical.length > 0;
  const hasMatches = dateGroups.length > 0 || historicalRows.length > 0;

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
              <dd
                className="tnum mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]"
                data-testid="v2-archive-total"
              >
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

      {hasRecords && (
        <div className="px-5 pt-4 sm:px-8">
          <label htmlFor="v2-archive-search" className="sr-only">
            {t("archive.search")}
          </label>
          <input
            id="v2-archive-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("archive.searchPlaceholder")}
            className="h-11 w-full rounded-xl border border-line bg-panel px-3.5 text-[14px] outline-none transition focus:border-line-strong focus:ring-2 focus:ring-accent/15 sm:max-w-md"
            data-testid="v2-archive-search"
          />
        </div>
      )}

      {!hasRecords ? (
        <p className="px-5 py-16 text-center text-[14px] text-muted sm:px-8">{t("v2.archive.empty")}</p>
      ) : !hasMatches ? (
        <p className="px-5 py-16 text-center text-[14px] text-muted sm:px-8">{t("archive.noMatch")}</p>
      ) : (
        <div className="px-5 pt-6 sm:px-8">
          {dateGroups.map((group) => (
            <section key={group.date ?? "unknown"} className="pt-3" data-testid="v2-archive-date-group">
              <div className="flex items-baseline justify-between gap-4 border-b border-line-strong py-2.5">
                <h2 className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.012em]">
                  {group.date ? mediumDate(group.date, locale) : t("v2.billed")}
                </h2>
                <span className="tnum shrink-0 text-[15px] font-semibold">{moneyExact(group.total)}</span>
              </div>
              <ul>
                {group.entries.map(({ project, client }) => (
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
                          {client.name}
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

          {historicalRows.length > 0 && (
            <section className="pt-10" data-testid="v2-archive-history">
              <div className="border-b border-line-strong py-2.5">
                <h2 className="text-[16px] font-semibold tracking-[-0.012em]">{t("archive.historySection")}</h2>
              </div>
              <div className="space-y-3 pt-3">
                {historicalRows.map((group) => (
                  <HistoricalRecordRow key={group.projectId} group={group} />
                ))}
              </div>
            </section>
          )}
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
