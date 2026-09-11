"use client";

import { useMemo, useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, Checkbox, ConfirmSheet, EmptyState, PageHeader } from "@/components/ui";
import { billingBoard, type BoardGroup, type BoardItem, type BoardProject } from "@/lib/billing-v2/board";
import { isCostPriced, serviceLabel } from "@/lib/billing-v2/services";
import { moneyExact } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type { Snapshot } from "@/lib/types";
import { NewProjectModal } from "./new-project-modal";
import { ProjectModal } from "./project-modal";

/**
 * The Billing screen: every client's current work in one list, split into what
 * can be billed now and what cannot yet. Each row keeps the line-item detail
 * visible so a billing decision does not require opening the modal.
 *
 * Both status sections are selectable, and only ready work counts towards the
 * billing total.
 */
export function BillingBoard({ snapshot, clientId }: { snapshot: Snapshot; clientId: string | null }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const sections = useMemo(() => billingBoard(snapshot, clientId), [snapshot, clientId]);
  const printingCostOutstanding = Math.round(
    [...sections.ready, ...sections.inProgress]
      .flatMap((group) => group.projects)
      .flatMap((project) => project.items)
      .filter((entry) => isCostPriced(entry.service))
      .reduce((total, entry) => total + (entry.item.printCost ?? 0), 0) * 100,
  ) / 100;

  const projectsById = useMemo(() => {
    const map = new Map<string, { project: BoardProject; clientName: string }>();
    for (const group of [...sections.ready, ...sections.inProgress]) {
      for (const project of group.projects) {
        map.set(project.id, { project, clientName: group.client.name });
      }
    }
    return map;
  }, [sections]);

  const readyProjectIds = useMemo(
    () => new Set(sections.ready.flatMap((group) => group.projects.map((project) => project.id))),
    [sections.ready],
  );
  const inProgressProjectIds = useMemo(
    () => new Set(sections.inProgress.flatMap((group) => group.projects.map((project) => project.id))),
    [sections.inProgress],
  );
  const selectable = useMemo(
    () => new Set([...readyProjectIds, ...inProgressProjectIds]),
    [readyProjectIds, inProgressProjectIds],
  );

  const chosen = Array.from(selected).filter((id) => selectable.has(id));
  const chosenReady = chosen.filter((id) => readyProjectIds.has(id));
  const chosenInProgress = chosen.filter((id) => inProgressProjectIds.has(id));
  const canMarkReady = chosenInProgress.length > 0 && chosenInProgress.every((id) => {
    const project = projectsById.get(id)?.project;
    return project !== undefined && project.items.length > 0 && project.pricePendingCount === 0;
  });
  const chosenTotal =
    Math.round(
      chosen.reduce((sum, id) => sum + (projectsById.get(id)?.project.total ?? 0), 0) * 100,
    ) / 100;

  const toggle = (id: string, status: "READY" | "IN_PROGRESS") =>
    setSelected((current) => {
      const sectionIds = status === "READY" ? readyProjectIds : inProgressProjectIds;
      const next = new Set(Array.from(current).every((selectedId) => sectionIds.has(selectedId)) ? current : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const moveSelected = async (readiness: "READY" | "IN_PROGRESS") => {
    const projectIds = readiness === "READY" ? chosenInProgress : chosenReady;
    if (projectIds.length === 0) return;
    const ok = await run(
      () => Promise.all(
        projectIds.map((projectId) =>
          api(`/api/projects/${projectId}/readiness`, { method: "PATCH", body: { readiness } }),
        ),
      ),
      { key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done" },
    );
    if (ok) setSelected(new Set());
  };

  const markBilled = async () => {
    setConfirming(false);
    if (chosenReady.length === 0) return;
    const ok = await run(
      () => api("/api/billing-v2/billed", { method: "POST", body: { projectIds: chosenReady } }),
      { key: "v2.markBilled.done" },
    );
    if (ok) setSelected(new Set());
  };

  const open = openProject ? projectsById.get(openProject) : undefined;
  const nothingAtAll = sections.ready.length === 0 && sections.inProgress.length === 0;

  return (
    <div className="pb-8">
      <div className="animate-rise">
        <PageHeader
        title={t("v2.billing.title")}
        subtitle={
          <>
            <span>{t("v2.billing.subtitle")}</span>
            <span
              className="mt-1 block text-[12px] text-faint"
              data-testid="v2-printing-cost-outstanding"
            >
              {t("v2.printingCostOutstanding")}: {moneyExact(printingCostOutstanding)}
            </span>
          </>
        }
        action={
          <div className="flex items-center gap-3">
            <span className="text-right">
              <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                {t("v2.total")}
              </span>
              <span
                className="tnum block text-[19px] font-semibold leading-tight tracking-[-0.02em]"
                data-testid="v2-page-total"
              >
                {moneyExact(sections.readyTotal)}
              </span>
            </span>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="v2-new-project">
              {t("v2.newProject")}
            </Button>
          </div>
        }
        />

        {chosen.length > 0 && (
          <div
            className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3 shadow-[0_8px_28px_rgba(0,0,0,0.14)] sm:mx-8"
            data-testid="v2-selection-actions"
          >
            <span className="min-w-0">
              <span className="block text-[12px] text-muted">
                {t("v2.selected", { count: chosen.length })}
              </span>
              <span
                className="tnum block text-[19px] font-semibold leading-tight tracking-[-0.02em]"
                data-testid="v2-selected-total"
              >
                {moneyExact(chosenTotal)}
              </span>
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="primary"
                onClick={() => void moveSelected("READY")}
                disabled={busy || !canMarkReady}
                data-testid="v2-selection-mark-ready"
              >
                {t("v2.markReady")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void moveSelected("IN_PROGRESS")}
                disabled={busy || chosenReady.length === 0}
                data-testid="v2-selection-move-in-progress"
              >
                {t("v2.moveInProgress")}
              </Button>
              {chosenReady.length > 0 && (
                <>
                  <Button
                    variant="primary"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                    data-testid="v2-mark-billed"
                  >
                    {t("v2.markBilled")}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {nothingAtAll ? (
          <EmptyState title={t("v2.billing.empty")} />
        ) : (
          <div className="px-5 pb-8 sm:px-8">
          <Section label={t("v2.section.ready")} testId="v2-section-ready">
            {sections.ready.length === 0 ? (
              <p className="py-6 text-[13.5px] text-muted">{t("v2.section.readyEmpty")}</p>
            ) : (
              sections.ready.map((group) => (
                <ClientGroup key={group.client.id} group={group}>
                  {group.projects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      checked={selected.has(project.id)}
                      onToggle={() => toggle(project.id, "READY")}
                      onOpen={() => setOpenProject(project.id)}
                    />
                  ))}
                </ClientGroup>
              ))
            )}
          </Section>

          {sections.inProgress.length > 0 && (
            <Section label={t("v2.section.inProgress")} testId="v2-section-in-progress">
              {sections.inProgress.map((group) => (
                <ClientGroup key={group.client.id} group={group}>
                  {group.projects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      checked={selected.has(project.id)}
                      onToggle={() => toggle(project.id, "IN_PROGRESS")}
                      onOpen={() => setOpenProject(project.id)}
                    />
                  ))}
                </ClientGroup>
              ))}
            </Section>
          )}
          </div>
        )}
      </div>

      {open && (
        <ProjectModal
          key={projectModalKey(open.project)}
          project={open.project}
          clientName={open.clientName}
          serviceTypes={snapshot.serviceTypes}
          onClose={() => setOpenProject(null)}
        />
      )}

      {creating && (
        <NewProjectModal
          clients={snapshot.clients.filter((client) => client.active && client.name !== "DAISHIN")}
          defaultClientId={clientId}
          onClose={() => setCreating(false)}
        />
      )}

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={markBilled}
        busy={busy}
        title={t("v2.markBilled.confirmTitle")}
        message={t("v2.markBilled.confirmBody", {
          count: chosen.length,
          total: moneyExact(chosenTotal),
        })}
        confirmLabel={t("v2.markBilled")}
      />
    </div>
  );
}

/** The two halves of the screen are separated by a label and space, not a box. */
function Section({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-7 first:pt-1" data-testid={testId}>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.09em] text-faint">{label}</h2>
      {children}
    </section>
  );
}

function ClientGroup({ group, children }: { group: BoardGroup; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="pt-4" data-testid="v2-client-group">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
        <h3 className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.012em]">
          {group.client.name}
        </h3>
        <span className="shrink-0 text-[12.5px] text-muted">
          {t("v2.items", { count: group.itemCount })}
        </span>
        <span className="tnum shrink-0 text-[16px] font-semibold">
          {group.projects.some((project) => project.pricePendingCount > 0)
            ? "—"
            : moneyExact(group.total)}
        </span>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

/**
 * One project. A checkbox appears only where selecting it would mean
 * something; unbillable work keeps the same alignment and says why.
 */
function ProjectRow({
  project,
  checked,
  onToggle,
  onOpen,
}: {
  project: BoardProject;
  checked?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const selectable = onToggle !== undefined;
  const reason = project.blocker
    ? t(`v2.blocked.${project.blocker}` as MessageKey, {
        service: project.blockedBy ? t(project.blockedBy.service.labelKey) : "",
      })
    : null;

  return (
    <li
      className="grid grid-cols-[21px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line py-4"
      data-testid={selectable ? "v2-project-row" : "v2-project-row-blocked"}
    >
      {selectable ? (
        <Checkbox checked={!!checked} onChange={onToggle} label={project.name} />
      ) : (
        <span aria-hidden />
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("v2.openProject", { name: project.name })}
        className="min-w-0 text-left"
        data-testid="v2-open-project"
      >
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
          {project.name}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
          {t("v2.items", { count: project.items.length })}
          {reason ? ` · ${reason}` : ""}
        </span>
        <span
          className="mt-1 block space-y-0.5 text-[11.5px] leading-5 text-faint"
          data-testid="v2-line-item-breakdown"
        >
          {project.items.map((entry) => (
            <span
              key={entry.item.id}
              className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0"
              data-testid="v2-line-item"
            >
              <span className="min-w-0 break-words">{lineItemDescription(entry, t)}</span>
              <span className="tnum shrink-0">{displayAmount(entry.amount)}</span>
              {isCostPriced(entry.service) && (
                <span className="tnum shrink-0">
                  ({t("v2.cost")} {displayAmount(entry.item.printCost)})
                </span>
              )}
            </span>
          ))}
          {project.pricePendingCount > 0 && (
            <span className="block">{t("v2.pricePending", { count: project.pricePendingCount })}</span>
          )}
        </span>
      </button>
      <span className="tnum shrink-0 text-[15px]" data-testid="v2-project-total">
        {displayProjectTotal(project)}
      </span>
    </li>
  );
}

function lineItemDescription(
  entry: BoardItem,
  translate: (key: MessageKey) => string,
): string {
  const description = entry.item.description.trim();
  if (/^(print|printing)$/i.test(description) && entry.item.quantity !== 1) {
    return `${serviceLabel(entry.service, translate)} x${entry.item.quantity}`;
  }
  return description || serviceLabel(entry.service, translate);
}

function displayAmount(value: number | null | undefined): string {
  return value == null ? "—" : moneyExact(value);
}

function displayProjectTotal(project: BoardProject): string {
  return project.pricePendingCount > 0 ? "—" : moneyExact(project.total);
}

function projectModalKey(project: BoardProject): string {
  return [
    project.id,
    project.name,
    project.note,
    project.billingReadiness,
    project.blocker,
    project.pricePendingCount,
    ...project.items.map((entry) => [
      entry.item.id,
      entry.item.description,
      entry.item.quantity,
      entry.item.printCost,
      entry.item.priceReviewStatus,
      entry.item.billingStatus,
      entry.amount,
      entry.recommended,
      entry.manual,
      entry.service.key,
    ].join("~")),
  ].join("|");
}
