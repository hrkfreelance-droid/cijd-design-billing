"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ChevronRight, PlusIcon, SearchIcon } from "@/components/icons";
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
  StatusDot,
  StatusTag,
} from "@/components/ui";
import { projectStatus, sum } from "@/lib/derive";
import { money, shortDate } from "@/lib/format";

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
        const items = scope.idx.itemsByProject.get(project.id) ?? [];
        return {
          project,
          items,
          client: scope.idx.clientById.get(project.clientId),
          status: projectStatus(items),
          total: sum(items),
        };
      })
      .filter(({ project, client }) =>
        term
          ? project.name.toLowerCase().includes(term) ||
            (client?.name ?? "").toLowerCase().includes(term)
          : true,
      )
      .sort((a, b) => b.project.date.localeCompare(a.project.date));
  }, [scope, query]);

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("projects.title")}
        subtitle={t("projects.count", { count: scope.projects.length })}
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

      {scope.projects.length === 0 ? (
        <EmptyState title={t("projects.empty")} hint={t("projects.emptyHint")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("projects.noMatch")} />
      ) : (
        <>
          <div className="hidden px-6 pb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-faint sm:mx-8 sm:flex sm:items-center sm:gap-4 sm:px-6">
            <span className="w-[84px] shrink-0">{t("common.date")}</span>
            <span className="flex-1">{t("common.project")}</span>
            <span className="w-[140px] shrink-0">{t("common.status")}</span>
            <span className="w-[84px] shrink-0 text-right">{t("common.amount")}</span>
            <span className="w-4 shrink-0" />
          </div>
          <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
            {rows.map(({ project, client, status, total }) => (
              <Link
                key={project.id}
                href={`/designer/projects/${project.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-fill active:bg-fill sm:gap-4 sm:px-6"
              >
                <span className="tnum hidden w-[84px] shrink-0 text-[13px] text-faint sm:block">
                  {shortDate(project.date, locale)}
                </span>
                {status && (
                  <span className="sm:hidden">
                    <StatusDot status={status} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
                    {project.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-faint sm:hidden">
                    {[client?.name, shortDate(project.date, locale)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-0.5 hidden truncate text-[12.5px] text-faint sm:block">
                    {client?.name}
                  </span>
                </span>
                <span className="hidden w-[140px] shrink-0 sm:block">
                  {status && <StatusTag status={status} />}
                </span>
                <Amount value={money(total)} className="w-[84px] shrink-0 text-right text-[15px]" />
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
              </Link>
            ))}
          </div>
        </>
      )}

      <NewProjectSheet open={creating} onClose={() => setCreating(false)} />
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
