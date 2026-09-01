"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ChevronDown } from "@/components/icons";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import {
  Amount,
  Button,
  Checkbox,
  EmptyState,
  PageHeader,
  PageTotal,
} from "@/components/ui";
import { can } from "@/lib/auth/roles";
import {
  isOperationalRecord,
  isPrintPriceConfirmed,
  isProductionComplete,
  sum,
} from "@/lib/derive";
import { money, todayIso } from "@/lib/format";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import type { BillingItem, Client, Invoice } from "@/lib/types";

/** Everything here has completed production. That is the whole rule for this screen. */
export default function OfficeBillingPage() {
  const scope = useScope();
  const { t } = useI18n();
  const { user } = useSession();
  const router = useRouter();

  const allowed = !!user && can(user.role, "billing:read");

  useEffect(() => {
    if (user && !allowed) router.replace("/office/payments");
  }, [user, allowed, router]);

  const groups = useMemo(() => {
    if (!scope) return [];
    const ready = scope.items.filter(
      (item) =>
        isOperationalRecord(item) &&
        isProductionComplete(item) && item.billingStatus === "READY_TO_INVOICE",
    );
    const byClient = new Map<string, BillingItem[]>();
    for (const item of ready) {
      const clientId = scope.idx.projectById.get(item.projectId)?.clientId;
      if (!clientId) continue;
      const list = byClient.get(clientId);
      if (list) list.push(item);
      else byClient.set(clientId, [item]);
    }
    return Array.from(byClient)
      .map(([clientId, items]) => ({ client: scope.idx.clientById.get(clientId)!, items }))
      .filter((group) => group.client)
      .sort((a, b) => sum(b.items) - sum(a.items));
  }, [scope]);

  const pendingPrintItems = useMemo(
    () =>
      scope?.items.filter(
        (item) =>
          isOperationalRecord(item) &&
          item.type === "PRINT" &&
          !isPrintPriceConfirmed(item),
      ) ?? [],
    [scope],
  );

  if (!scope || !allowed) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("billing.ready")}
        subtitle={scope.client ? scope.client.name : t("client.all")}
        action={
          <PageTotal
            value={money(groups.flatMap((group) => group.items).reduce((total, item) => total + item.amount, 0))}
          />
        }
      />

      {groups.length === 0 ? (
        <EmptyState title={t("billing.readyEmpty")} />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <ReadyGroup key={group.client.id} client={group.client} items={group.items} />
          ))}
        </div>
      )}

      {pendingPrintItems.length > 0 && <PrintPriceQueue items={pendingPrintItems} />}
    </div>
  );
}

/** Print work is visible to Billing, but only Printing can confirm its price. */
function PrintPriceQueue({ items }: { items: BillingItem[] }) {
  const { t } = useI18n();
  const scope = useScope();

  return (
    <section className="pt-8">
      <div className="px-5 pb-2 sm:px-8">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
          {t("billing.printPricePendingTitle")}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          {t("billing.printPricePendingHint")}
        </p>
      </div>
      <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
        {items.map((item) => {
          const project = scope?.idx.projectById.get(item.projectId);
          const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
          const unknownAmount = item.amount <= 0;
          return (
            <div key={item.id} className="flex flex-col gap-2 px-5 py-3.5 sm:px-6">
              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium">
                    {project?.name ?? ""}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                    {client?.name} · {printLabel(item)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[14.5px] tnum">
                    {unknownAmount ? t("billing.amountUnknown") : money(item.amount)}
                  </span>
                  <span className="mt-1 block text-[12px] text-review">
                    {t("billing.printPricePending")}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReadyGroup({ client, items }: { client: Client; items: BillingItem[] }) {
  const { t } = useI18n();
  const { locale } = useI18n();
  const scope = useScope();
  const router = useRouter();
  const { runResult, busy } = useAction();
  const [open, setOpen] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  // Work is billed per project, the way it is quoted and remembered.
  const projects = useMemo(() => {
    const groups = new Map<string, BillingItem[]>();
    for (const item of items) {
      const list = groups.get(item.projectId);
      if (list) list.push(item);
      else groups.set(item.projectId, [item]);
    }
    return Array.from(groups)
      .map(([projectId, projectItems]) => ({
        id: projectId,
        name: scope?.idx.projectById.get(projectId)?.name ?? "",
        date: scope?.idx.projectById.get(projectId)?.date ?? "",
        deliveredAt: projectItems[0]?.deliveredAt ?? null,
        items: projectItems,
        total: sum(projectItems),
      }))
      .sort((a, b) => (a.deliveredAt ?? "").localeCompare(b.deliveredAt ?? ""));
  }, [items, scope]);

  const selectedProjects = projects.filter((project) => !skipped.has(project.id));
  const selectedItems = selectedProjects.flatMap((project) => project.items);

  const markInvoiced = async () => {
    if (!selectedItems.length) return;
    const created = await runResult<Invoice>(
      () =>
        api<Invoice>("/api/invoices", {
          method: "POST",
          body: {
            clientId: client.id,
            invoiceDate: todayIso(),
            billingItemIds: selectedItems.map((item) => item.id),
          },
        }),
      { key: "toast.invoiceCreated" },
    );
    if (created) {
      downloadInvoicePdf({
        invoice: created,
        clientName: client.name,
        items: selectedItems,
        projectNames: new Map(
          projects.map((project) => [project.id, project.name]),
        ),
        locale,
      });
      router.push("/office/payments");
    }
  };

  const toggle = (id: string) => {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-fill sm:px-6"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
          {client.name}
        </span>
        <span className="text-[12.5px] text-faint">
          {t("billing.items", { count: items.length })}
        </span>
        <Amount value={money(sum(items))} strong className="text-[15px]" />
      </button>

      {open && (
        <>
          <div className="divide-y divide-line border-t border-line">
            {projects.map((project) => {
              const checked = !skipped.has(project.id);
              return (
                <div key={project.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                  <Checkbox
                    checked={checked}
                    onChange={() => toggle(project.id)}
                    label={project.name}
                  />
                  <button
                    onClick={() => toggle(project.id)}
                    className={`min-w-0 flex-1 text-left transition-opacity duration-150 ${
                      checked ? "" : "opacity-45"
                    }`}
                  >
                    <span className="block truncate text-[14.5px]">{project.name}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                      {project.items.map((item) => item.description).join(" · ")}
                    </span>
                  </button>
                  <Amount
                    value={money(project.total)}
                    className={`text-[14.5px] transition-opacity duration-150 ${
                      checked ? "" : "opacity-45"
                    }`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 border-t border-line px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span className="text-[13px] text-muted">
              {t("billing.selected", { count: selectedItems.length })} ·{" "}
              <span className="tnum">{money(sum(selectedItems))}</span>
            </span>
            <Button
              variant="primary"
              onClick={markInvoiced}
              disabled={selectedItems.length === 0 || busy}
              className="w-full sm:w-auto"
            >
              {t("billing.createInvoice")}
            </Button>
          </div>
        </>
      )}

    </section>
  );
}

function printLabel(item: BillingItem): string {
  const description = item.description.trim();
  if (/\bprint(?:ing)?\b\s+(?:[x×]\s*)?\d+\b/i.test(description)) return description;
  if (/\b[x×]\s*\d+\b/i.test(description)) return description;
  return `${description} ×${item.quantity}`;
}
