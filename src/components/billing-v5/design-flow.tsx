"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { NewProjectModal } from "@/components/billing-v2/new-project-modal";
import { projectReason } from "@/components/billing-v2/project-detail";
import { ProjectModal } from "@/components/billing-v3/project-modal";
import { isBilled, selectableClients, type BoardGroup, type BoardProject, type BoardSections } from "@/lib/billing-v2/board";
import { isCostPriced, serviceLabel } from "@/lib/billing-v2/services";
import { useV5T } from "@/lib/billing-v5/i18n";
import { moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { BILLING } from "./workspace-parts";

type Tab = "READY" | "IN_PROGRESS";

/** Words used only on this screen, kept here so the shared dictionaries stay untouched. */
const WORDS = {
  en: {
    lead: "Set the final amounts, then move finished work to Ready to bill. Ready work is sent to Accounting from here.",
    search: "Search project, customer or item",
    allCustomers: "All customers",
    items: "items",
    lines: "Line items",
    qty: "Qty",
    unit: "Unit",
    amount: "Amount",
    flow: "Progress",
    fProgress: "In progress",
    fReady: "Ready to bill",
    fAccounting: "Accounting",
    fPaid: "Paid",
    date: "Date",
    customer: "Customer",
    costTotal: "Print cost",
    note: "Note",
    priceHistory: "Price history",
    openPage: "Open page",
    empty: "No projects here.",
    pickOne: "Choose a project on the left.",
    noItems: "Add at least one line before marking it ready.",
    selected: "{count} selected",
    clear: "Clear",
  },
  ja: {
    lead: "金額を確定し、終わった案件を請求可能へ移します。請求可能の案件は、ここから経理へ送ります。",
    search: "案件・顧客・品目で探す",
    allCustomers: "すべての顧客",
    items: "品目",
    lines: "明細",
    qty: "数量",
    unit: "単価",
    amount: "金額",
    flow: "進み具合",
    fProgress: "進行中",
    fReady: "請求可能",
    fAccounting: "経理",
    fPaid: "入金",
    date: "日付",
    customer: "顧客",
    costTotal: "印刷の原価",
    note: "メモ",
    priceHistory: "値段の履歴",
    openPage: "ページで開く",
    empty: "ここに案件はありません。",
    pickOne: "左の一覧から案件を選んでください。",
    noItems: "請求可能にする前に、明細を1行以上入れてください。",
    selected: "{count}件を選択",
    clear: "選択を外す",
  },
  kh: {
    lead: "កំណត់ចំនួនទឹកប្រាក់ចុងក្រោយ ហើយផ្លាស់ការងារដែលរួចទៅ «រួចរាល់ចេញវិក្កយបត្រ»។ ការងាររួចរាល់ត្រូវផ្ញើទៅគណនេយ្យពីទីនេះ។",
    search: "ស្វែងរកគម្រោង អតិថិជន ឬមុខទំនិញ",
    allCustomers: "អតិថិជនទាំងអស់",
    items: "មុខ",
    lines: "បញ្ជីមុខ",
    qty: "ចំនួន",
    unit: "តម្លៃឯកតា",
    amount: "ទឹកប្រាក់",
    flow: "វឌ្ឍនភាព",
    fProgress: "កំពុងធ្វើ",
    fReady: "រួចរាល់ចេញវិក្កយបត្រ",
    fAccounting: "គណនេយ្យ",
    fPaid: "បានបង់",
    date: "កាលបរិច្ឆេទ",
    customer: "អតិថិជន",
    costTotal: "ថ្លៃដើមបោះពុម្ព",
    note: "កំណត់សម្គាល់",
    priceHistory: "ប្រវត្តិតម្លៃ",
    openPage: "បើកទំព័រ",
    empty: "មិនមានគម្រោងនៅទីនេះទេ។",
    pickOne: "ជ្រើសគម្រោងពីបញ្ជីខាងឆ្វេង។",
    noItems: "បន្ថែមយ៉ាងហោចណាស់មួយបន្ទាត់ មុនសម្គាល់ថារួចរាល់។",
    selected: "បានជ្រើស {count}",
    clear: "ដកការជ្រើស",
  },
} as const;
type Word = keyof (typeof WORDS)["en"];

function useWords() {
  const { locale } = useI18n();
  return (key: Word, vars?: Record<string, string | number>) => {
    let text: string = (WORDS[locale as keyof typeof WORDS] ?? WORDS.en)[key];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

/**
 * The Design screen in the shared DAISHIN layout: a stage tab per state, a
 * list grouped by customer on the left and one project open on the right
 * with the single next step as its main button.
 */
export function DesignFlow({ snapshot, sections, projectLink }: {
  snapshot: Snapshot;
  sections: BoardSections;
  projectLink?: (id: string) => string;
}) {
  const { t } = useI18n();
  const v5t = useV5T();
  const w = useWords();
  const { run, busy } = useAction();
  const [tab, setTab] = useState<Tab>(sections.readyCount > 0 ? "READY" : "IN_PROGRESS");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ id: string; edit: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<string[] | null>(null);

  const groups: BoardGroup[] = tab === "READY" ? sections.ready : sections.inProgress;
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => groups
    .filter((group) => !client || group.client.id === client)
    .map((group) => ({
      ...group,
      projects: group.projects.filter((project) => !needle || [
        project.name, group.client.name, project.note,
        ...project.items.map((entry) => entry.item.description),
      ].join(" ").toLowerCase().includes(needle)),
    }))
    .filter((group) => group.projects.length > 0), [groups, client, needle]);

  const lookup = useMemo(() => {
    const map = new Map<string, { project: BoardProject; clientName: string; clientId: string; tab: Tab }>();
    for (const [key, list] of [["READY", sections.ready], ["IN_PROGRESS", sections.inProgress]] as const) {
      for (const group of list) for (const project of group.projects) {
        map.set(project.id, { project, clientName: group.client.name, clientId: group.client.id, tab: key });
      }
    }
    return map;
  }, [sections]);

  const firstVisible = visible[0]?.projects[0]?.id ?? null;
  const open = current && lookup.get(current)?.tab === tab ? lookup.get(current) : firstVisible ? lookup.get(firstVisible) : undefined;

  // Selections never cross tabs, and drop projects that moved away.
  const chosenProjects = Array.from(chosen).map((id) => lookup.get(id)).filter((e) => e?.tab === tab).map((e) => e!.project);
  const chosenTotal = Math.round(chosenProjects.reduce((sum, p) => sum + p.total, 0) * 100) / 100;
  const chosenBlocked = chosenProjects.some((p) => p.pricePendingCount > 0 || p.items.length === 0);

  const toggle = (id: string) => setChosen((ids) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleGroup = (group: BoardGroup, on: boolean) => setChosen((ids) => {
    const next = new Set(ids);
    for (const project of group.projects) { if (on) next.add(project.id); else next.delete(project.id); }
    return next;
  });

  const move = async (ids: string[], readiness: "READY" | "IN_PROGRESS") => {
    const ok = await run(async () => {
      for (const id of ids) await api(`/api/projects/${id}/readiness`, { method: "PATCH", body: { readiness } });
    }, { key: readiness === "READY" ? "v2.markReady.done" : "v2.moveInProgress.done" });
    if (ok) setChosen(new Set());
  };
  const sendToAccounting = async () => {
    const ids = confirming ?? [];
    const ok = await run(async () => {
      for (const id of ids) await api(`/api/projects/${id}/readiness`, { method: "PATCH", body: { readiness: "ACCOUNTING" } });
    });
    setConfirming(null);
    if (ok) setChosen(new Set());
  };
  const confirmTotal = (confirming ?? []).reduce((sum, id) => sum + (lookup.get(id)?.project.total ?? 0), 0);

  const modalEntry = modal ? lookup.get(modal.id) : undefined;

  return (
    <div className="df-page" data-billing-design="" data-v3-pricing-mode="qty-unit-derived-total">
      <div className="df-head" data-layout-group>
        <div className="min-w-0">
          <h1>{v5t("design.title")}</h1>
          <p>{w("lead")}</p>
        </div>
        <button type="button" className="df-primary df-primary-sm" onClick={() => setCreating(true)} data-testid="v2-new-project">
          + {t("v2.newProject")}
        </button>
      </div>

      <div className="df-tabs" role="tablist" aria-label={v5t("design.title")}>
        <button role="tab" type="button" aria-selected={tab === "READY"} onClick={() => { setTab("READY"); setChosen(new Set()); }} data-testid="v2-section-ready">
          {t("v2.section.ready")}<span className="df-count tnum">{sections.readyCount}</span>
          <span className="df-tab-total tnum" data-testid="v2-page-total">{moneyExact(sections.readyTotal)}</span>
        </button>
        <button role="tab" type="button" aria-selected={tab === "IN_PROGRESS"} onClick={() => { setTab("IN_PROGRESS"); setChosen(new Set()); }} data-testid="v2-section-in-progress">
          {t("v2.section.inProgress")}<span className="df-count tnum" data-testid="v2-progress-total">{sections.inProgressCount}</span>
        </button>
      </div>

      <div className="df-bar" data-layout-group>
        <input className="df-ctl df-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={w("search")} aria-label={w("search")} />
        <select className="df-ctl" value={client} onChange={(e) => setClient(e.target.value)} aria-label={w("customer")}>
          <option value="">{w("allCustomers")}</option>
          {groups.map((group) => <option key={group.client.id} value={group.client.id}>{group.client.name}</option>)}
        </select>
      </div>

      <div className="df-grid">
        <section className="df-list" aria-label={tab === "READY" ? t("v2.section.ready") : t("v2.section.inProgress")}>
          {visible.length === 0 && <p className="df-empty">{groups.length === 0 ? t("v2.billing.empty") : w("empty")}</p>}
          {visible.map((group) => {
            const all = group.projects.every((p) => chosen.has(p.id));
            const some = group.projects.some((p) => chosen.has(p.id));
            return (
              <div key={group.client.id} className="df-group" data-testid="v2-client-group">
                <div className="df-group-head" data-layout-group>
                  <Check checked={all} mixed={some && !all} onChange={() => toggleGroup(group, !all)} label={t("v2.selectClient", { name: group.client.name })} />
                  <span className="df-group-name">{group.client.name}</span>
                  <span className="tnum">{tab === "READY" ? moneyExact(group.total) : t("v2.projects", { count: group.projects.length })}</span>
                </div>
                {group.projects.map((project) => {
                  const pending = project.pricePendingCount > 0;
                  const reason = projectReason(project, t);
                  return (
                    <div key={project.id} className="df-row" aria-current={open?.project.id === project.id} data-project-id={project.id} data-testid="v2-project-row">
                      <Check checked={chosen.has(project.id)} onChange={() => toggle(project.id)} label={project.name} />
                      <button type="button" className="df-row-open" onClick={() => setCurrent(project.id)} aria-label={t("v2.openProject", { name: project.name })} data-testid="v2-open-project">
                        <span className="df-row-name">{project.name}</span>
                        <span className="df-row-meta tnum">
                          {project.items.length} {w("items")} · {project.date}
                          {reason ? <span className={pending ? "df-warn" : undefined}> · {reason}</span> : null}
                        </span>
                        <span className="df-row-amt tnum" data-testid="v2-project-total">
                          {project.items.length === 0 ? "" : pending ? "—" : moneyExact(project.total)}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>

        {open ? (
          <Detail
            key={open.project.id}
            entry={open}
            busy={busy}
            projectLink={projectLink}
            onEdit={() => setModal({ id: open.project.id, edit: true })}
            onReady={() => void move([open.project.id], "READY")}
            onBack={() => void move([open.project.id], "IN_PROGRESS")}
            onSend={() => setConfirming([open.project.id])}
          />
        ) : (
          <article className="df-panel df-panel-empty">{w("pickOne")}</article>
        )}
      </div>

      {chosenProjects.length > 0 && (
        <div className="df-selection" data-testid="v2-selection-actions">
          <div className="df-selection-in" data-layout-group>
            <span className="df-selection-sum">
              <small>{w("selected", { count: chosenProjects.length })}</small>
              <strong className="tnum" data-testid="v2-selected-total">{moneyExact(chosenTotal)}</strong>
            </span>
            {tab === "IN_PROGRESS" && chosenBlocked && <span className="df-warn df-selection-hint">{t("v2.pricePendingHint")}</span>}
            <span className="df-spacer" />
            <button type="button" className="df-ghost" onClick={() => setChosen(new Set())}>{w("clear")}</button>
            {tab === "READY" ? (
              <>
                <button type="button" className="df-ghost" disabled={busy} onClick={() => void move(chosenProjects.map((p) => p.id), "IN_PROGRESS")} data-testid="v2-selection-move-in-progress">{t("v2.moveInProgress")}</button>
                <button type="button" className="df-primary" disabled={busy} onClick={() => setConfirming(chosenProjects.map((p) => p.id))} data-testid="v2-mark-billed">{v5t("design.sendAccounting")}</button>
              </>
            ) : (
              <button type="button" className="df-primary" disabled={busy || chosenBlocked} onClick={() => void move(chosenProjects.map((p) => p.id), "READY")} data-testid="v2-selection-mark-ready">{t("v2.markReady")}</button>
            )}
          </div>
        </div>
      )}

      {modal && modalEntry && (
        <ProjectModal
          key={modal.id}
          project={modalEntry.project}
          clientName={modalEntry.clientName}
          clients={selectableClients(snapshot.clients)}
          serviceTypes={snapshot.serviceTypes}
          depositLocked={snapshot.billingItems.some((item) => item.projectId === modal.id && !item.deletedAt && isBilled(item))}
          accountingFlow
          initialEdit={modal.edit}
          onClose={() => setModal(null)}
        />
      )}

      {creating && (
        <NewProjectModal
          clients={selectableClients(snapshot.clients)}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setTab("IN_PROGRESS"); setCurrent(id); }}
        />
      )}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={() => void sendToAccounting()}
        busy={busy}
        title={v5t("design.sendAccountingTitle")}
        message={v5t("design.sendAccountingBody", { count: confirming?.length ?? 0, total: moneyExact(confirmTotal) })}
        confirmLabel={v5t("design.sendAccounting")}
        testId="v2-confirm-bill"
      />
    </div>
  );
}

function Detail({ entry, busy, projectLink, onEdit, onReady, onBack, onSend }: {
  entry: { project: BoardProject; clientName: string; clientId: string; tab: Tab };
  busy: boolean;
  projectLink?: (id: string) => string;
  onEdit: () => void;
  onReady: () => void;
  onBack: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  const v5t = useV5T();
  const w = useWords();
  const { project, clientName, clientId, tab } = entry;
  const pending = project.pricePendingCount > 0;
  const reason = projectReason(project, t);
  const blocked = pending || project.items.length === 0;
  const showCost = project.items.some((e) => isCostPriced(e.service));
  const step = tab === "READY" ? 2 : 1;

  return (
    <article className="df-panel" aria-labelledby="df-title" data-testid="billing-project-detail">
      <header className="df-p-head">
        <span className="df-st">{tab === "READY" ? t("v2.section.ready") : t("v2.section.inProgress")}{reason ? ` · ${reason}` : ""}</span>
        <h2 id="df-title">{project.name}</h2>
        <Link className="df-sub" href={`${BILLING}/customers/${encodeURIComponent(clientId)}`}>{clientName}</Link>
        <div className="df-amt tnum">
          <b>{project.items.length === 0 ? "—" : pending ? "—" : moneyExact(project.total)}</b>
          {project.balance.deposit > 0 && <span>{t("v3.deposit")} {moneyExact(project.balance.deposit)} · {t("v3.remaining")} {moneyExact(project.balance.remaining)}</span>}
        </div>
      </header>

      <dl className="df-facts">
        <div><dt>{w("date")}</dt><dd className="tnum">{project.date}</dd></div>
        <div><dt>{w("lines")}</dt><dd className="tnum">{project.items.length}</dd></div>
        {showCost && <div><dt>{w("costTotal")}</dt><dd className="tnum">{moneyExact(project.costTotal)}</dd></div>}
      </dl>

      <section className="df-sec">
        <h3><span>{w("lines")}</span><Link href={`${BILLING}/price-history?q=${encodeURIComponent(project.items[0]?.item.description ?? project.name)}`}>{w("priceHistory")}</Link></h3>
        {project.items.length === 0 ? <p className="df-muted">{w("noItems")}</p> : (
          <div className="df-table-wrap">
            <table className="df-table">
              <thead><tr><th>{w("lines")}</th><th className="r">{w("qty")}</th><th className="r">{w("unit")}</th>{showCost && <th className="r">{t("v2.cost")}</th>}<th className="r">{w("amount")}</th></tr></thead>
              <tbody>
                {project.items.map((e) => {
                  const label = serviceLabel(e.service, t);
                  const desc = e.item.description.trim();
                  return (
                    <tr key={e.item.id} data-testid="v2-line-item">
                      <td>
                        <span className="df-line-name">{desc || label}</span>
                        {desc && desc.toLowerCase() !== label.toLowerCase() && <small>{label}</small>}
                      </td>
                      <td className="r tnum">{e.item.quantity}</td>
                      <td className="r tnum">{e.finalUnitPrice == null ? "—" : moneyExact(e.finalUnitPrice)}</td>
                      {showCost && <td className="r tnum df-muted">{isCostPriced(e.service) ? (e.cost == null ? "—" : moneyExact(e.cost)) : ""}</td>}
                      <td className="r tnum">{e.amount == null ? <span className="df-warn">—</span> : moneyExact(e.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {project.note && (
        <section className="df-sec"><h3><span>{w("note")}</span></h3><p className="df-note">{project.note}</p></section>
      )}

      <section className="df-sec">
        <h3><span>{w("flow")}</span></h3>
        <ol className="df-flow">
          {[w("fProgress"), w("fReady"), w("fAccounting"), w("fPaid")].map((label, i) => (
            <li key={label} data-on={i < step}>{label}</li>
          ))}
        </ol>
      </section>

      <div className="df-act" data-testid="v2-readiness-action">
        {tab === "READY" ? (
          <button type="button" className="df-primary" disabled={busy} onClick={onSend} data-testid="v2-detail-mark-billed">{v5t("design.sendAccounting")}</button>
        ) : (
          <button type="button" className="df-primary" disabled={busy || blocked} onClick={onReady} data-testid="v2-mark-ready">{t("v2.markReady")}</button>
        )}
        <button type="button" className="df-ghost" onClick={onEdit} disabled={busy} data-testid="v2-modal-edit">{t("v2.edit")}</button>
        {tab === "READY" && (
          <button type="button" className="df-ghost" onClick={onBack} disabled={busy} data-testid="v2-move-in-progress">{t("v2.moveInProgress")}</button>
        )}
        {projectLink && <Link className="df-ghost df-link-btn" href={projectLink(project.id)}>{w("openPage")}</Link>}
      </div>
      {tab === "IN_PROGRESS" && blocked && <p className="df-hint">{project.items.length === 0 ? w("noItems") : t("v2.pricePendingHint")}</p>}
    </article>
  );
}

function Check({ checked, mixed = false, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={mixed ? "mixed" : checked} aria-label={label} onClick={onChange} className="df-check" data-on={checked || mixed}>
      <span aria-hidden>{mixed ? "–" : checked ? "✓" : ""}</span>
    </button>
  );
}
