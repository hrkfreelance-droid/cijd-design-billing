"use client";

import { useMemo, useState } from "react";

import { BillingItemCard } from "@/components/billing-item-card";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { ProjectEditorModal } from "@/components/project-editor-modal";
import { api, useClientFilter, useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import {
  Amount,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageTotal,
  Select,
  Sheet,
} from "@/components/ui";
import {
  isOperationalRecord,
  isProductionComplete,
  priceState,
  sum,
} from "@/lib/derive";
import { formatKhr } from "@/lib/exchange-rate";
import { mediumDate, money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

export default function ProjectsPage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!scope) return [];
    const term = query.trim().toLowerCase();
    return scope.projects
      .map((project) => {
        const items = (scope.idx.itemsByProject.get(project.id) ?? [])
          .filter(isOperationalRecord)
          .filter((item) => !isProductionComplete(item));
        return { project, items, client: scope.idx.clientById.get(project.clientId) };
      })
      .filter(({ items }) => items.length > 0)
      .filter(({ project, client, items }) =>
        term
          ? project.name.toLowerCase().includes(term) ||
            (client?.name ?? "").toLowerCase().includes(term) ||
            items.some((item) => item.description.toLowerCase().includes(term))
          : true,
      )
      // Operational queues are FIFO: the oldest unfinished job is always first.
      .sort(
        (a, b) =>
          a.project.date.localeCompare(b.project.date) ||
          a.project.createdAt.localeCompare(b.project.createdAt),
      );
  }, [scope, query]);

  const inProgressItems = useMemo(
    () => scope?.items.filter((item) => isOperationalRecord(item) && !isProductionComplete(item)) ?? [],
    [scope],
  );
  const estimated = inProgressItems.some((item) => priceState(item) !== "CONFIRMED");

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("projects.title")}
        subtitle={t("projects.count", { count: rows.length })}
        action={
          <PageTotal
            value={money(sum(inProgressItems.filter((item) => item.amount > 0)))}
            label={estimated ? t("projects.estimatedTotal") : undefined}
            secondaryValue={
              scope.snapshot.exchangeRate
                ? formatKhr(
                    sum(inProgressItems.filter((item) => item.amount > 0)),
                    scope.snapshot.exchangeRate.rate,
                  )
                : undefined
            }
            secondaryLabel={
              scope.snapshot.exchangeRate
                ? t("currency.rate", { rate: scope.snapshot.exchangeRate.rate })
                : undefined
            }
            rate={scope.snapshot.exchangeRate?.rate}
            rateEffectiveDate={scope.snapshot.exchangeRate?.effectiveDate}
            rateFetchedAt={scope.snapshot.exchangeRateLastCheckedAt}
          />
        }
      />

      <div className="-mt-1.5 flex items-center gap-2 px-5 pb-3 sm:px-8">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("projects.search")}
            aria-label={t("projects.search")}
            className="h-10 w-full rounded-xl bg-fill pl-9 pr-3 text-[14px] placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="h-10">
          <PlusIcon className="h-[15px] w-[15px]" />
          {t("projects.new")}
        </Button>
      </div>

      {rows.length === 0 && !query.trim() ? (
        <EmptyState title={t("projects.empty")} hint={t("projects.emptyHint")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("projects.noMatch")} />
      ) : (
        <div className="space-y-3 px-5 pb-8 sm:px-8">
          {rows.map(({ project, client, items }) => (
            <article
              key={project.id}
              data-testid="designer-project-group"
              role="button"
              tabIndex={0}
              aria-label={project.name}
              onClick={(event) => {
                if (hasInteractiveTarget(event.target)) return;
                setSelectedProjectId(project.id);
              }}
              onKeyDown={(event) => {
                if ((event.key !== "Enter" && event.key !== " ") || hasInteractiveTarget(event.target)) return;
                event.preventDefault();
                setSelectedProjectId(project.id);
              }}
              className="group cursor-pointer overflow-hidden border-y border-line bg-panel outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent sm:rounded-2xl sm:border sm:hover:border-line-strong"
            >
              <div className="border-b border-line px-5 py-2 transition-colors duration-150 group-hover:bg-fill active:bg-fill sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-[18px] font-semibold leading-tight tracking-[-0.014em] [overflow-wrap:anywhere]">
                      {project.name}
                    </h2>
                    <p className="mt-1 truncate text-[12.5px] text-faint">
                      {client?.name} · {mediumDate(project.date, locale)} · {project.createdBy}
                    </p>
                  </div>
                  <ProjectTotal items={items} />
                </div>
              </div>

              <div className="px-5 sm:px-6">
                <div className="divide-y divide-line">
                  {items.map((item) => (
                    <BillingItemCard key={item.id} item={item} projectId={project.id} />
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <NewProjectSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => setSelectedProjectId(id)}
      />
      <ProjectEditorModal
        projectId={selectedProjectId}
        open={selectedProjectId !== null}
        onClose={() => setSelectedProjectId(null)}
      />
    </div>
  );
}

function hasInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element &&
    !!target.closest("button, a, input, select, textarea, [role='checkbox'], [data-no-row-open]");
}

function ProjectTotal({ items }: { items: BillingItem[] }) {
  const { t } = useI18n();
  const pendingCount = items.filter((item) => priceState(item) === "PENDING").length;
  const estimated = items.some((item) => priceState(item) !== "CONFIRMED");
  const knownTotal = sum(items.filter((item) => item.amount > 0));

  return (
    <div className="shrink-0 text-right">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
        {t(estimated ? "projects.estimatedTotal" : "projects.total")}
      </p>
      <Amount value={knownTotal > 0 ? money(knownTotal) : "—"} strong className="mt-0.5 block text-[18px] tracking-[-0.015em]" />
      {pendingCount > 0 && (
        <p className="mt-0.5 text-[11.5px] font-medium text-review">
          {t("projects.pendingPrices", { count: pendingCount })}
        </p>
      )}
    </div>
  );
}

function NewProjectSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const scope = useScope();
  const { clientId } = useClientFilter();
  const { runResult, busy } = useAction();
  const clients = (scope?.snapshot.clients ?? []).filter((c) => c.active);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>("");

  const target = selected || clientId || clients[0]?.id || "";
  const close = () => {
    setName("");
    setSelected("");
    onClose();
  };

  const submit = async () => {
    if (!name.trim() || !target) return;
    const created = await runResult<{ id: string }>(
      () => api<{ id: string }>("/api/projects", { method: "POST", body: { clientId: target, name } }),
      { key: "toast.projectCreated" },
    );
    if (created) {
      close();
      onCreated(created.id);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("projects.new")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={close}>{t("common.cancel")}</Button>
          <Button variant="primary" full onClick={submit} disabled={!name.trim() || !target || busy}>{t("projects.create")}</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t("common.client")}>
          <Select value={target} onChange={(event) => setSelected(event.target.value)}>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </Select>
        </Field>
        <Field label={t("projects.name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("projects.namePlaceholder")}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
          />
        </Field>
      </div>
    </Sheet>
  );
}
