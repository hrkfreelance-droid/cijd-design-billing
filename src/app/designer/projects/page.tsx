"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PlusIcon, SearchIcon } from "@/components/icons";
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
  Select,
  Sheet,
  StatusTag,
} from "@/components/ui";
import {
  isOperationalRecord,
  priceState,
  projectStatus,
  sum,
} from "@/lib/derive";
import { money, monthLabel } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

export default function ProjectsPage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    if (!scope) return [];
    const term = query.trim().toLowerCase();
    return scope.projects
      .map((project) => {
        const items = (scope.idx.itemsByProject.get(project.id) ?? []).filter(
          isOperationalRecord,
        ).filter((item) => item.productionStatus !== "DELIVERED");
        return {
          project,
          items,
          client: scope.idx.clientById.get(project.clientId),
          status: projectStatus(items),
        };
      })
      .filter(({ items }) => items.length > 0)
      .filter(({ project, client, items }) =>
        term
          ? project.name.toLowerCase().includes(term) ||
            (client?.name ?? "").toLowerCase().includes(term) ||
            // Keep search at the project level while still finding an item.
            items.some((item) => item.description.toLowerCase().includes(term))
          : true,
      )
      .sort((a, b) => b.project.date.localeCompare(a.project.date));
  }, [scope, query]);

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("projects.title")}
        subtitle={t("projects.count", { count: rows.length })}
        action={
          <Button variant="secondary" onClick={() => setCreating(true)} className="shrink-0">
            <PlusIcon className="h-[15px] w-[15px]" />
            {t("projects.new")}
          </Button>
        }
      />

      <div className="px-5 pb-4 sm:px-8">
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("projects.search")}
            aria-label={t("projects.search")}
            className="h-10 w-full rounded-xl bg-fill pl-9 pr-3 text-[14px] placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {rows.length === 0 && !query.trim() ? (
        <EmptyState title={t("projects.empty")} hint={t("projects.emptyHint")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("projects.noMatch")} />
      ) : (
        <div className="space-y-6 px-5 pb-8 sm:px-8">
          {rows.map(({ project, client, status, items }) => (
            <section
              key={project.id}
              data-testid="designer-project-group"
              className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border"
            >
              <Link
                href={`/designer/projects/${project.id}`}
                className="block border-b border-line px-5 py-5 transition-colors duration-150 hover:bg-fill active:bg-fill sm:px-6"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-semibold uppercase leading-tight tracking-[0.01em]">
                      {project.name}
                    </h2>
                    <p className="mt-1.5 truncate text-[12.5px] text-faint">
                      {client?.name} · {monthLabel(project.date.slice(0, 7), locale)} · {t("projects.items", { count: items.length })}
                    </p>
                  </div>
                  {status && <StatusTag status={status} className="text-[11.5px] uppercase tracking-[0.04em]" />}
                </div>
              </Link>

              <div className="px-5 sm:px-6">
                <div className="hidden grid-cols-[minmax(0,1fr)_auto] gap-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-faint sm:grid">
                  <span>{t("item.description")}</span>
                  <span className="text-right">{t("common.amount")}</span>
                </div>
                <div className="divide-y divide-line">
                  {items.map((item) => (
                    <ProjectItemRow key={item.id} item={item} projectId={project.id} />
                  ))}
                </div>
              </div>

              <ProjectTotal items={items} />
            </section>
          ))}
        </div>
      )}

      <NewProjectSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectItemRow({ item, projectId }: { item: BillingItem; projectId: string }) {
  const { t } = useI18n();
  const workState =
    item.productionStatus === "DELIVERED"
      ? t("projects.delivered")
      : item.billingStatus === "NEEDS_REVIEW"
        ? t("projects.review")
        : t("projects.inProgress");

  return (
    <Link
      data-testid="designer-project-item"
      href={`/designer/projects/${projectId}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-4 transition-colors duration-150 hover:bg-fill active:bg-fill"
    >
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] tracking-[-0.005em]">{item.description}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
          <span>{t(`type.${item.type}`)}</span>
          <span aria-hidden>·</span>
          <span>{workState}</span>
        </span>
      </span>
      <PriceStateLabel item={item} />
    </Link>
  );
}

function PriceStateLabel({ item }: { item: BillingItem }) {
  const { t } = useI18n();
  const state = priceState(item);

  if (state === "PENDING") {
    return (
      <span className="flex min-w-[108px] flex-col items-end gap-0.5 text-right">
        <span className="text-[13px] font-medium text-review">{t("projects.pricePending")}</span>
        <span className="text-[11px] text-review">{t("projects.priceReview")}</span>
      </span>
    );
  }

  return (
    <span className="flex min-w-[108px] flex-col items-end gap-0.5 text-right">
      <span className={`tnum text-[14px] font-medium ${state === "SUGGESTED" ? "text-review" : "text-text"}`}>
        {t(
          state === "SUGGESTED" ? "projects.priceSuggested" : "projects.priceConfirmed",
          { amount: money(item.amount) },
        )}
      </span>
      {state === "SUGGESTED" && (
        <span className="text-[11px] text-review">{t("projects.priceReview")}</span>
      )}
    </span>
  );
}

function ProjectTotal({ items }: { items: BillingItem[] }) {
  const { t } = useI18n();
  const hasSuggested = items.some((item) => priceState(item) === "SUGGESTED");
  const pendingCount = items.filter((item) => priceState(item) === "PENDING").length;
  const knownTotal = sum(items.filter((item) => item.amount > 0));

  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
          {t(hasSuggested ? "projects.estimatedTotal" : "projects.total")}
        </p>
        {pendingCount > 0 && (
          <p className="mt-0.5 text-[11.5px] text-review">
            {t("projects.pendingPrices", { count: pendingCount })}
          </p>
        )}
      </div>
      <Amount
        value={knownTotal > 0 ? money(knownTotal) : "—"}
        strong
        className="text-[16px]"
      />
    </div>
  );
}

function NewProjectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const scope = useScope();
  const { clientId } = useClientFilter();
  const { run, busy } = useAction();
  const router = useRouter();
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
    let created: { id: string } | null = null;
    const ok = await run(async () => {
      created = await api<{ id: string }>("/api/projects", {
        method: "POST",
        body: { clientId: target, name },
      });
    }, { key: "toast.projectCreated" });
    if (ok && created) {
      close();
      router.push(`/designer/projects/${(created as { id: string }).id}`);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("projects.new")}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" full onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            full
            onClick={submit}
            disabled={!name.trim() || !target || busy}
          >
            {t("projects.create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t("common.client")}>
          <Select value={target} onChange={(event) => setSelected(event.target.value)}>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("projects.name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("projects.namePlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </Field>
      </div>
    </Sheet>
  );
}
