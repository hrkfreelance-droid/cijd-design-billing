"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import {
  billingBoard,
  selectableClients,
  type BoardGroup,
  type BoardItem,
  type BoardProject,
} from "@/lib/billing-v2/board";
import { isCostPriced, serviceLabel } from "@/lib/billing-v2/services";
import { moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { NewProjectModal } from "@/components/billing-v2/new-project-modal";
import { Price, projectReason } from "@/components/billing-v2/project-detail";
import { ProjectModal } from "./project-modal";

type Section = "READY" | "IN_PROGRESS";

/**
 * The Billing screen: every client's current work in one list, split into what
 * can be billed now and what cannot yet. Each project shows its lines — what
 * each one is, its final price and, for printing, its cost — so a billing
 * decision can be made from the list without opening anything.
 */
export function BillingV3Board({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<{ section: Section; ids: Set<string> }>({
    section: "READY",
    ids: new Set(),
  });
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingBill, setConfirmingBill] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const board = useMemo(() => billingBoard(snapshot), [snapshot]);

  const lookup = useMemo(() => {
    const map = new Map<string, { project: BoardProject; clientName: string; section: Section }>();
    for (const [section, groups] of [["READY", board.ready], ["IN_PROGRESS", board.inProgress]] as const) {
      for (const group of groups) {
        for (const project of group.projects) map.set(project.id, { project, clientName: group.client.name, section });
      }
    }
    return map;
  }, [board]);

  // A selection only ever holds projects that are still where they were picked.
  const chosen = Array.from(selected.ids)
    .map((id) => lookup.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.section === selected.section)
    .map((entry) => entry.project);
  const chosenTotal = Math.round(chosen.reduce((sum, project) => sum + project.total, 0) * 100) / 100;
  const chosenPending = chosen.some((project) => project.pricePendingCount > 0 || project.items.length === 0);

  const setIds = (section: Section, update: (ids: Set<string>) => void) =>
    setSelected((current) => {
      const ids = new Set(current.section === section ? current.ids : []);
      update(ids);
      return { section, ids };
    });

  const toggle = (id: string, section: Section) =>
    setIds(section, (ids) => {
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
    });

  const toggleGroup = (group: BoardGroup, section: Section, on: boolean) =>
    setIds(section, (ids) => {
      for (const project of group.projects) {
        if (on) ids.add(project.id);
        else ids.delete(project.id);
      }
    });

  const clear = () => setSelected((current) => ({ ...current, ids: new Set() }));

  const moveSelected = async (readiness: "READY" | "IN_PROGRESS") => {
    const ids = chosen.map((project) => project.id);
    if (!ids.length) return;
    const ok = await run(
      async () => {
        for (const id of ids) {
          await api(`/api/projects/${id}/readiness`, { method: "PATCH", body: { readiness } });
        }
      },
      { key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done" },
    );
    if (ok) clear();
  };

  const markBilled = async () => {
    const ids = chosen.map((project) => project.id);
    const ok = await run(
      () => api("/api/billing-v2/billed", { method: "POST", body: { projectIds: ids } }),
      { key: "v2.markBilled.done" },
    );
    setConfirmingBill(false);
    if (ok) clear();
  };

  // A new project is shown where it landed, briefly marked, so it can be found.
  useEffect(() => {
    if (!highlight) return;
    const row = document.querySelector(`[data-project-id="${highlight}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlight(null), 2400);
    return () => clearTimeout(timer);
  }, [highlight, board]);

  const open = openProject ? lookup.get(openProject) : undefined;
  const empty = board.ready.length === 0 && board.inProgress.length === 0;

  return (
    <div className={chosen.length ? "pb-36" : "pb-16"}>
      <header className="px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] sm:text-[30px]">
              {t("v2.billing.title")}
            </h1>
            <p className="mt-1 text-[13.5px] text-muted">{t("v2.billing.subtitle")}</p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)} className="mt-1" data-testid="v2-new-project">
            <span aria-hidden className="-ml-0.5 text-[17px] font-normal leading-none">+</span>
            {t("v2.newProject")}
          </Button>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-12">
          <Figure label={t("v2.section.ready")} testId="v2-page-total" strong>
            {moneyExact(board.readyTotal)}
          </Figure>
          <Figure label={t("v2.section.inProgress")}>
            {t("v2.projects", { count: board.inProgressCount })}
          </Figure>
          <Figure label={t("v2.printingCostOutstanding")} testId="v2-printing-cost-outstanding">
            {moneyExact(board.printCostOutstanding)}
          </Figure>
        </dl>
      </header>

      {empty ? (
        <p className="px-5 py-16 text-center text-[14px] text-muted sm:px-8">{t("v2.billing.empty")}</p>
      ) : (
        <div className="px-5 sm:px-8">
          <BoardSection
            label={t("v2.section.ready")}
            count={board.readyCount}
            total={board.readyTotal}
            testId="v2-section-ready"
          >
            {board.ready.length === 0 ? (
              <p className="border-t border-line py-6 text-[13.5px] text-muted">{t("v2.section.readyEmpty")}</p>
            ) : (
              board.ready.map((group) => (
                <ClientGroup
                  key={group.client.id}
                  group={group}
                  selection={selected.section === "READY" ? selected.ids : undefined}
                  onToggleAll={(on) => toggleGroup(group, "READY", on)}
                >
                  {group.projects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      checked={selected.section === "READY" && selected.ids.has(project.id)}
                      highlighted={highlight === project.id}
                      onToggle={() => toggle(project.id, "READY")}
                      onOpen={() => setOpenProject(project.id)}
                    />
                  ))}
                </ClientGroup>
              ))
            )}
          </BoardSection>

          {board.inProgress.length > 0 && (
            <BoardSection
              label={t("v2.section.inProgress")}
              count={board.inProgressCount}
              testId="v2-section-in-progress"
            >
              {board.inProgress.map((group) => (
                <ClientGroup key={group.client.id} group={group}>
                  {group.projects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      checked={selected.section === "IN_PROGRESS" && selected.ids.has(project.id)}
                      highlighted={highlight === project.id}
                      onToggle={() => toggle(project.id, "IN_PROGRESS")}
                      onOpen={() => setOpenProject(project.id)}
                    />
                  ))}
                </ClientGroup>
              ))}
            </BoardSection>
          )}
        </div>
      )}

      {chosen.length > 0 && (
        <SelectionBar
          count={chosen.length}
          total={chosenTotal}
          onClear={clear}
          hint={selected.section === "IN_PROGRESS" && chosenPending ? t("v2.pricePendingHint") : null}
        >
          {selected.section === "READY" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void moveSelected("IN_PROGRESS")}
                disabled={busy}
                data-testid="v2-selection-move-in-progress"
              >
                {t("v2.moveInProgress")}
              </Button>
              <Button
                variant="primary"
                onClick={() => setConfirmingBill(true)}
                disabled={busy}
                data-testid="v2-mark-billed"
              >
                {t("v2.markBilled")}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => void moveSelected("READY")}
              disabled={busy || chosenPending}
              data-testid="v2-selection-mark-ready"
            >
              {t("v2.markReady")}
            </Button>
          )}
        </SelectionBar>
      )}

      {open && (
        <ProjectModal
          key={open.project.id}
          project={open.project}
          clientName={open.clientName}
          serviceTypes={snapshot.serviceTypes}
          onClose={() => setOpenProject(null)}
        />
      )}

      {creating && (
        <NewProjectModal
          clients={selectableClients(snapshot.clients)}
          onClose={() => setCreating(false)}
          onCreated={setHighlight}
        />
      )}

      <ConfirmDialog
        open={confirmingBill}
        onClose={() => setConfirmingBill(false)}
        onConfirm={() => void markBilled()}
        busy={busy}
        title={t("v2.markBilled.confirmTitle")}
        message={t("v2.markBilled.confirmBody", { count: chosen.length, total: moneyExact(chosenTotal) })}
        confirmLabel={t("v2.markBilled")}
        testId="v2-confirm-bill"
      />
    </div>
  );
}

function Figure({
  label,
  children,
  strong = false,
  testId,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd
        className={`tnum mt-0.5 truncate leading-tight tracking-[-0.02em] ${
          strong ? "text-[22px] font-semibold" : "text-[17px] font-medium text-text/85"
        }`}
        data-testid={testId}
      >
        {children}
      </dd>
    </div>
  );
}

/** The two halves of the screen are separated by a label and space, not a box. */
function BoardSection({
  label,
  count,
  total,
  testId,
  children,
}: {
  label: string;
  count: number;
  total?: number;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="pt-9" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-4 pb-1">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
          <span className="tnum ml-2 font-normal text-faint">{count}</span>
        </h2>
        {total !== undefined && (
          <span className="tnum text-[13px] font-medium text-muted">{moneyExact(total)}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function ClientGroup({
  group,
  selection,
  onToggleAll,
  children,
}: {
  group: BoardGroup;
  /** Present when this group's projects can be selected together. */
  selection?: Set<string>;
  onToggleAll?: (on: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const all = !!selection && group.projects.every((project) => selection.has(project.id));
  const some = !!selection && group.projects.some((project) => selection.has(project.id));
  return (
    <div className="pt-3" data-testid="v2-client-group">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center border-b border-line-strong">
        {onToggleAll ? (
          <RowCheckbox
            checked={all}
            mixed={some && !all}
            onChange={() => onToggleAll(!all)}
            label={t("v2.selectClient", { name: group.client.name })}
          />
        ) : (
          <span aria-hidden />
        )}
        <h3 className="min-w-0 truncate py-2.5 text-[16px] font-semibold tracking-[-0.012em]">{group.client.name}</h3>
        {/* Only billable work carries a total; in-progress groups show their size. */}
        {onToggleAll ? (
          <span className="tnum shrink-0 pl-4 text-[15px] font-semibold">{moneyExact(group.total)}</span>
        ) : (
          <span className="shrink-0 pl-4 text-[12.5px] text-muted">
            {t("v2.projects", { count: group.projects.length })}
          </span>
        )}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

/**
 * One project: name and total on the first line, then every line item with
 * its price. The checkbox has its own 44px target so ticking a row never
 * opens it, and opening a row never ticks it.
 */
function ProjectRow({
  project,
  checked,
  highlighted,
  onToggle,
  onOpen,
}: {
  project: BoardProject;
  checked: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const reason = projectReason(project, t);
  const pending = project.pricePendingCount > 0;

  return (
    <li
      className={`grid grid-cols-[2.75rem_minmax(0,1fr)] border-b border-line transition-colors duration-700 ${
        highlighted ? "bg-accent/10" : checked ? "bg-accent/[0.045]" : ""
      }`}
      data-project-id={project.id}
      data-testid="v2-project-row"
    >
      <RowCheckbox checked={checked} onChange={onToggle} label={project.name} className="self-start pt-[13px]" />
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("v2.openProject", { name: project.name })}
        className="group min-w-0 py-3.5 text-left"
        data-testid="v2-open-project"
      >
        <span className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 text-[15px] font-medium leading-snug tracking-[-0.01em] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
            {project.name}
          </span>
          {/* A total is only a total when every line has a price; the reason
              line below says what is missing. */}
          <span className="tnum shrink-0 text-[15px] font-semibold" data-testid="v2-project-total">
            {project.items.length === 0 ? "" : pending ? <span className="font-normal text-faint">—</span> : moneyExact(project.total)}
          </span>
        </span>
        {reason && (
          <span
            className={`mt-0.5 block text-[12.5px] ${project.blocker === "PRICE" ? "text-pending" : "text-muted"}`}
            data-testid="v2-project-reason"
          >
            {reason}
          </span>
        )}
        {project.items.length > 0 && (
          <span className="mt-1.5 block space-y-[3px]" data-testid="v2-line-item-breakdown">
            {project.items.map((entry) => (
              <LineItem key={entry.item.id} entry={entry} />
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

function LineItem({ entry }: { entry: BoardItem }) {
  const { t } = useI18n();
  const label = serviceLabel(entry.service, t);
  const description = entry.item.description.trim();
  const quantity = entry.item.quantity;
  const showQuantity = quantity !== 1 && !description.includes(String(quantity));
  const costPriced = isCostPriced(entry.service);
  return (
    <span
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[13px] leading-5 sm:grid-cols-[minmax(0,1fr)_8rem_6.5rem]"
      data-testid="v2-line-item"
    >
      <span className="min-w-0 truncate">
        <span className="text-muted">{label}</span>
        {description && description.toLowerCase() !== label.toLowerCase() && (
          <span className="text-text/90"> · {description}</span>
        )}
        {showQuantity && <span className="tnum text-faint"> ×{quantity}</span>}
      </span>
      <span className="tnum hidden text-right text-[12.5px] text-faint sm:block">
        {costPriced ? (
          <>
            {t("v2.cost")} {entry.cost == null ? "—" : moneyExact(entry.cost)}
          </>
        ) : null}
      </span>
      <Price value={entry.amount} className="text-right text-muted" />
      {costPriced && (
        <span className="tnum col-span-2 -mt-0.5 text-[12px] text-faint sm:hidden">
          {t("v2.cost")} {entry.cost == null ? "—" : moneyExact(entry.cost)}
        </span>
      )}
    </span>
  );
}

function RowCheckbox({
  checked,
  mixed = false,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={`group/check flex h-11 w-11 items-center justify-start ${className}`}
    >
      <span
        className={`flex h-[20px] w-[20px] items-center justify-center rounded-[6px] border transition-colors duration-150 ${
          checked || mixed
            ? "border-accent bg-accent text-on-accent"
            : "border-line-strong bg-panel text-transparent group-hover/check:border-accent"
        }`}
      >
        {mixed ? <span className="h-[2px] w-2.5 rounded bg-current" /> : <CheckIcon className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

function SelectionBar({
  count,
  total,
  hint,
  onClear,
  children,
}: {
  count: number;
  total: number;
  hint: string | null;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="animate-rise fixed inset-x-0 bottom-0 z-40" data-testid="v2-selection-actions">
      <div className="safe-bottom-bar header-surface border-t border-line backdrop-blur-xl">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-x-4 gap-y-2.5 px-5 pt-3 sm:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={onClear}
              aria-label={t("v2.clearSelection")}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill text-muted transition-colors hover:text-text"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <span className="min-w-0">
              <span className="block text-[12px] text-muted">{t("v2.selected", { count })}</span>
              <span className="tnum block text-[18px] font-semibold leading-tight tracking-[-0.02em]" data-testid="v2-selected-total">
                {moneyExact(total)}
              </span>
            </span>
          </div>
          {hint && <p className="order-last w-full text-[12.5px] text-pending sm:order-none sm:w-auto">{hint}</p>}
          <div className="grid w-full auto-cols-fr grid-flow-col gap-2 sm:flex sm:w-auto sm:shrink-0 [&>button]:h-auto [&>button]:min-h-10 [&>button]:min-w-0 [&>button]:py-1.5 [&>button]:leading-tight">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

