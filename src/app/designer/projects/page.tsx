"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PlusIcon, SearchIcon } from "@/components/icons";
import { BillingItemCard } from "@/components/billing-item-card";
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
} from "@/components/ui";
import {
  isOperationalRecord,
  isProductionComplete,
  priceState,
  sum,
} from "@/lib/derive";
import { money, monthLabel } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

export default function ProjectsPage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    if (!scope) return [];
    const term = query.trim().toLowerCase();
    return scope.projects
      .map((project) => {
        const items = (scope.idx.itemsByProject.get(project.id) ?? []).filter(
          isOperationalRecord,
        ).filter((item) => !isProductionComplete(item));
        return {
          project,
          items,
          client: scope.idx.clientById.get(project.clientId),
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
          {rows.map(({ project, client, items }) => (
            <article
              key={project.id}
              data-testid="designer-project-group"
              tabIndex={0}
              aria-label={project.name}
              onClick={(event) => {
                if (hasInteractiveTarget(event.target)) return;
                router.push(`/designer/projects/${project.id}`);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || hasInteractiveTarget(event.target)) return;
                event.preventDefault();
                router.push(`/designer/projects/${project.id}`);
              }}
              className="group cursor-pointer overflow-hidden border-y border-line bg-panel outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent sm:rounded-2xl sm:border sm:hover:border-line-strong"
            >
              {/* Name, client, date, owner and money — everything needed to
                  recognise the project without opening it. */}
              <div className="border-b border-line px-5 py-5 transition-colors duration-150 group-hover:bg-fill active:bg-fill sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-[18px] font-semibold leading-tight tracking-[-0.014em] [overflow-wrap:anywhere]">
                      {project.name}
                    </h2>
                    <p className="mt-1.5 truncate text-[12.5px] text-faint">
                      {client?.name} · {monthLabel(project.date.slice(0, 7), locale)} ·{" "}
                      {project.createdBy}
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

      <NewProjectSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function hasInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element &&
    !!target.closest("button, a, input, select, textarea, [role='button'], [role='link']");
}

/**
 * A total is only called a Total when every price behind it is confirmed. A
 * suggested or missing price makes the figure an estimate, and saying so is
 * the difference between a number someone can invoice and one they cannot.
 */
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
      <Amount
        value={knownTotal > 0 ? money(knownTotal) : "—"}
        strong
        className="mt-0.5 block text-[18px] tracking-[-0.015em]"
      />
      {pendingCount > 0 && (
        <p className="mt-0.5 text-[11.5px] font-medium text-review">
          {t("projects.pendingPrices", { count: pendingCount })}
        </p>
      )}
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
