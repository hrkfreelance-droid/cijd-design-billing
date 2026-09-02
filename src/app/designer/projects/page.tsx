"use client";

import { useMemo, useState } from "react";

import { BillingItemCard } from "@/components/billing-item-card";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { ProjectEditorModal } from "@/components/project-editor-modal";
import { api, useClientFilter, useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { Button, EmptyState, Field, Input, Select, Sheet } from "@/components/ui";
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

  if (!scope) return <PageSkeleton />;

  const estimated = inProgressItems.some((item) => priceState(item) !== "CONFIRMED");
  const total = sum(inProgressItems.filter((item) => item.amount > 0));
  const rate = scope.snapshot.exchangeRate?.rate;

  return (
    <div className="animate-rise mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-text sm:text-[30px]">
            {t("projects.title")}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">{t("projects.count", { count: rows.length })}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">
            {estimated ? t("projects.estimatedTotal") : t("projects.total")}
          </p>
          <p className="tnum mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-text">{money(total)}</p>
          {rate ? (
            <p className="tnum mt-0.5 text-[11.5px] text-muted">
              {formatKhr(total, rate)} · NBC {rate.toLocaleString()} KHR/USD
            </p>
          ) : null}
        </div>
      </header>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("projects.search")}
            aria-label={t("projects.search")}
            className="h-11 w-full rounded-2xl border border-line bg-fill pl-9 pr-3 text-[14px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
        <Button variant="primary" onClick={() => setCreating(true)} className="!h-11 sm:min-w-[142px]">
          <PlusIcon className="h-[15px] w-[15px]" />
          {t("projects.new")}
        </Button>
      </div>

      {rows.length === 0 && !query.trim() ? (
        <EmptyState title={t("projects.empty")} hint={t("projects.emptyHint")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("projects.noMatch")} />
      ) : (
        <div className="space-y-3">
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
              className="group cursor-pointer overflow-hidden rounded-3xl border border-line bg-panel outline-none transition-colors hover:border-line-strong hover:bg-fill/30 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <h2 className="truncate text-[18px] font-semibold tracking-[-0.014em] text-text">
                    {project.name}
                  </h2>
                  <p className="mt-1 truncate text-[12.5px] text-muted">
                    {client?.name} · {mediumDate(project.date, locale)} · {project.createdBy}
                  </p>
                </div>
                <ProjectTotal items={items} />
              </div>

              <div className="border-t border-line px-2 py-1 sm:px-3">
                <div className="divide-y divide-line">
                  {items.map((item) => (
                    <BillingItemCard
                      key={item.id}
                      item={item}
                      projectId={project.id}
                      showActions={false}
                    />
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
      <p className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-faint">
        {t(estimated ? "projects.estimatedTotal" : "projects.total")}
      </p>
      <p className="tnum mt-0.5 text-[18px] font-semibold tracking-[-0.015em] text-text">
        {knownTotal > 0 ? money(knownTotal) : "—"}
      </p>
      {pendingCount > 0 && (
        <p className="mt-0.5 text-[11px] font-medium text-review">
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
