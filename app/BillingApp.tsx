"use client";

import { cloneElement, FormEvent, isValidElement, useEffect, useId, useRef, useState } from "react";
import { initialSnapshot } from "./lib/initial-data";
import { createLocalRepository } from "./lib/repository";
import { BillingItem, BillingSnapshot, BillingStatus, Client, Invoice, Project } from "./lib/types";

type View = "today" | "projects" | "billing" | "archive";
type BillingTab = "ready" | "awaiting" | "receipt";
type Theme = "light" | "dark";
type Language = "ja" | "en";
type Modal = "new-project" | "invoice" | "clients" | "restore" | null;

const TODAY = "2026-08-30";
const CURRENT_USER = "Hiroki";

const ui = {
  ja: {
    today: "今日",
    projects: "案件",
    billing: "請求",
    archive: "アーカイブ",
    allClients: "すべてのClient",
    addClient: "Clientを追加",
    light: "Light",
    dark: "Dark",
    search: "検索",
    searchProjects: "案件を検索",
    inProgress: "進行中",
    readyToInvoice: "請求待ち",
    awaitingPayment: "入金待ち",
    needsReview: "要確認",
    receiptPending: "Receipt待ち",
    completed: "完了",
    todayHeading: "今日やること",
    todaySubheading: "次に必要な作業だけを表示しています。",
    projectsHeading: "案件",
    projectsSubheading: "案件と請求項目を分けて管理します。",
    billingHeading: "請求",
    billingSubheading: "Clientごとの請求と入金状況を確認します。",
    archiveHeading: "アーカイブ",
    archiveSubheading: "確認済みの過去請求がここに表示されます。",
    newProject: "新しい案件",
    project: "案件",
    client: "Client",
    date: "日付",
    status: "ステータス",
    amount: "金額",
    items: "項目",
    total: "合計",
    openProject: "案件を開く",
    addItem: "項目を追加",
    description: "内容",
    type: "種別",
    quantity: "数量",
    unitPrice: "単価",
    add: "追加",
    close: "閉じる",
    cancel: "キャンセル",
    save: "保存",
    readyList: "請求待ちの項目",
    awaitingList: "入金待ちのInvoice",
    receiptList: "Receipt待ち",
    noItems: "請求待ちはありません",
    noAwaiting: "入金待ちはありません",
    noReceipt: "Receipt待ちはありません",
    selectItems: "請求する項目を選択",
    selected: "選択中",
    markAsInvoiced: "請求済みにする",
    oneClientOnly: "1つのInvoiceには1つのClientだけ選択できます。",
    invoiceNumber: "Invoice Number",
    invoiceDate: "Invoice Date",
    createInvoice: "Invoiceを作成",
    selectedForInvoice: "Invoiceにまとめる項目",
    invoiceCreated: "Invoiceを作成しました",
    invoiceNumberDuplicate: "同じInvoice Numberがすでにあります。別の番号を入力してください。",
    invoiceNumberRequired: "Invoice Numberを入力してください。",
    paymentDate: "Payment Date",
    paymentSlip: "Payment Slip",
    receiptStatus: "Receipt Status",
    confirmPayment: "入金確認",
    paymentConfirmed: "入金を確認しました",
    paymentAlreadyPaid: "このInvoiceはすでに入金済みです。二重確認はできません。",
    markReceipt: "Receipt受領済みにする",
    receiptMarked: "Receiptを受領済みにしました",
    allDone: "すべて完了しています",
    noProjects: "案件がありません",
    noProjectsSub: "Clientを選び、新しい案件を登録してください。",
    createProject: "案件を登録",
    projectName: "案件名",
    projectNameRequired: "案件名を入力してください。",
    clientRequired: "Clientを選択してください。",
    clientsHeading: "Client管理",
    clientName: "Client名",
    active: "有効",
    inactive: "停止中",
    clientAdded: "Clientを追加しました",
    clientUpdated: "Client名を更新しました",
    clientNameRequired: "Client名を入力してください。",
    rename: "名前を編集",
    restore: "アーカイブから戻す",
    restoreHeading: "アーカイブから戻しますか？",
    restoreBody: "請求済み項目を要確認に戻します。請求待ちには自動で戻りません。",
    restored: "要確認として戻しました",
    restoreConfirm: "戻す",
    archivedReadOnly: "完了済みの履歴です。新しい作業は追加できません。",
    clearFilters: "絞り込みを解除",
    month: "月",
    noVerifiedArchive: "確認済みのアーカイブはありません",
    archiveAwaitingData: "確認済みの履歴データを追加すると、ここに表示されます。",
    resetLocal: "ローカルデータを初期化",
    resetDone: "初期状態に戻しました",
    localMode: "確認済みデータ",
    todayDate: "2026年8月30日",
    showAll: "すべて表示",
    noActions: "今日のアクションはありません。",
    projectCreated: "案件を登録しました",
    savedLocally: "この端末に保存されます",
    closeMenu: "メニューを閉じる",
    workflow: "ワークフロー",
    invoice: "Invoice",
    paid: "入金済み",
    chooseOneClient: "1つのClientから項目を選択してください。",
    newItem: "新しい項目",
    updated: "更新",
    sharedLedger: "1つの共有台帳。",
    sharedLedgerBody: "案件は背景情報を持ち、請求項目は金額を持ちます。請求済みの項目は履歴に残ります。",
  },
  en: {
    today: "Today",
    projects: "Projects",
    billing: "Billing",
    archive: "Archive",
    allClients: "All Clients",
    addClient: "Add client",
    light: "Light",
    dark: "Dark",
    search: "Search",
    searchProjects: "Search projects",
    inProgress: "In Progress",
    readyToInvoice: "Ready to Invoice",
    awaitingPayment: "Awaiting Payment",
    needsReview: "Needs Review",
    receiptPending: "Receipt Pending",
    completed: "Completed",
    todayHeading: "What needs attention",
    todaySubheading: "Only the next useful actions are shown here.",
    projectsHeading: "Projects",
    projectsSubheading: "Keep project context separate from billable items.",
    billingHeading: "Billing",
    billingSubheading: "Review invoices and payment status by client.",
    archiveHeading: "Archive",
    archiveSubheading: "Verified historical billing appears here.",
    newProject: "New project",
    project: "Project",
    client: "Client",
    date: "Date",
    status: "Status",
    amount: "Amount",
    items: "Items",
    total: "Total",
    openProject: "Open project",
    addItem: "Add item",
    description: "Description",
    type: "Type",
    quantity: "Quantity",
    unitPrice: "Unit price",
    add: "Add",
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    readyList: "Items ready to invoice",
    awaitingList: "Invoices awaiting payment",
    receiptList: "Receipts to file",
    noItems: "No items to invoice.",
    noAwaiting: "No invoices awaiting payment.",
    noReceipt: "No receipts pending.",
    selectItems: "Select items to invoice",
    selected: "Selected",
    markAsInvoiced: "Mark as invoiced",
    oneClientOnly: "An invoice can contain items from one client only.",
    invoiceNumber: "Invoice Number",
    invoiceDate: "Invoice Date",
    createInvoice: "Create invoice",
    selectedForInvoice: "Items in this invoice",
    invoiceCreated: "Invoice created",
    invoiceNumberDuplicate: "That Invoice Number already exists. Enter a different number.",
    invoiceNumberRequired: "Enter an Invoice Number.",
    paymentDate: "Payment Date",
    paymentSlip: "Payment Slip",
    receiptStatus: "Receipt Status",
    confirmPayment: "Confirm payment",
    paymentConfirmed: "Payment confirmed",
    paymentAlreadyPaid: "This invoice is already paid. It cannot be confirmed twice.",
    markReceipt: "Mark receipt received",
    receiptMarked: "Receipt marked received",
    allDone: "Everything is up to date",
    noProjects: "No projects found",
    noProjectsSub: "Choose a client and add a new project.",
    createProject: "Create project",
    projectName: "Project name",
    projectNameRequired: "Enter a project name.",
    clientRequired: "Choose a client.",
    clientsHeading: "Clients",
    clientName: "Client name",
    active: "Active",
    inactive: "Inactive",
    clientAdded: "Client added",
    clientUpdated: "Client name updated",
    clientNameRequired: "Enter a client name.",
    rename: "Edit name",
    restore: "Return from archive",
    restoreHeading: "Return this from archive?",
    restoreBody: "Paid items will return as Needs Review. They will not become invoice candidates automatically.",
    restored: "Returned as Needs Review",
    restoreConfirm: "Return",
    archivedReadOnly: "Completed history is read-only. Add new work as a separate item.",
    clearFilters: "Clear filters",
    month: "Month",
    noVerifiedArchive: "No verified archive records",
    archiveAwaitingData: "Verified historical records will appear here after import.",
    resetLocal: "Reset local data",
    resetDone: "Initial state restored",
    localMode: "Verified data",
    todayDate: "August 30, 2026",
    showAll: "Show all",
    noActions: "No actions for today.",
    projectCreated: "Project created",
    savedLocally: "Saved on this device",
    closeMenu: "Close menu",
    workflow: "Workflow",
    invoice: "Invoice",
    paid: "Paid",
    chooseOneClient: "Choose items from one client.",
    newItem: "New item",
    updated: "Updated",
    sharedLedger: "One shared ledger.",
    sharedLedgerBody: "Projects hold context. Billing items hold the charge. Only verified records should be moved into history.",
  },
} as const;

type TranslationKey = keyof typeof ui.en;

const statusLabels: Record<BillingStatus, TranslationKey> = {
  IN_PROGRESS: "inProgress",
  READY_TO_INVOICE: "readyToInvoice",
  INVOICED: "awaitingPayment",
  PAID: "completed",
  NEEDS_REVIEW: "needsReview",
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "today": return <svg {...common}><path d="M4 5.5h16v14H4z" /><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16h5" /></svg>;
    case "projects": return <svg {...common}><path d="M4 6.5h6l2 2h8v10H4z" /><path d="M4 10.5h16" /></svg>;
    case "billing": return <svg {...common}><path d="M5 4.5h14v15H5z" /><path d="M8 8.5h8M8 12h8M8 15.5h4" /></svg>;
    case "archive": return <svg {...common}><path d="M4 6h16v14H4zM3 4h18v3H3z" /><path d="M9 11h6" /></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "arrow": return <svg {...common}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
    case "search": return <svg {...common}><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.2 4.2" /></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>;
    case "moon": return <svg {...common}><path d="M20 15.3A8.2 8.2 0 0 1 8.7 4 8.4 8.4 0 1 0 20 15.3Z" /></svg>;
    case "close": return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "check": return <svg {...common}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
    case "alert": return <svg {...common}><path d="M12 4 21 19H3z" /><path d="M12 9v4M12 16.5h.01" /></svg>;
    case "receipt": return <svg {...common}><path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case "users": return <svg {...common}><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3" /><path d="M16 11a3 3 0 0 0 0-6M17 15h1a3 3 0 0 1 3 3v2" /></svg>;
    case "filter": return <svg {...common}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
    case "edit": return <svg {...common}><path d="m5 16.5-.8 3.3 3.3-.8L19 7.5a2.1 2.1 0 0 0-3-3z" /><path d="m14.5 6.5 3 3" /></svg>;
    case "lock": return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case "chevron": return <svg {...common}><path d="m9 5 7 7-7 7" /></svg>;
    default: return null;
  }
}

function cloneSnapshot(snapshot: BillingSnapshot): BillingSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as BillingSnapshot;
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatAmount(amount: number, language: Language) {
  return new Intl.NumberFormat(language === "ja" ? "ja-JP" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}

function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function projectStatus(projectId: string, items: BillingItem[]): BillingStatus {
  const projectItems = items.filter((item) => item.projectId === projectId);
  if (!projectItems.length) return "IN_PROGRESS";
  if (projectItems.some((item) => item.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (projectItems.every((item) => item.status === "PAID")) return "PAID";
  if (projectItems.some((item) => item.status === "READY_TO_INVOICE")) return "READY_TO_INVOICE";
  if (projectItems.some((item) => item.status === "IN_PROGRESS")) return "IN_PROGRESS";
  return "INVOICED";
}

function statusClass(status: BillingStatus) {
  return `status status-${status.toLowerCase()}`;
}

export default function BillingApp() {
  const repositoryRef = useRef(createLocalRepository());
  const [snapshot, setSnapshot] = useState<BillingSnapshot>(repositoryRef.current.load());
  const [isReady, setIsReady] = useState(false);
  const [view, setView] = useState<View>("today");
  const [billingTab, setBillingTab] = useState<BillingTab>("ready");
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [clientFilter, setClientFilter] = useState("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveMonth, setArchiveMonth] = useState("");
  const [archiveClientFilter, setArchiveClientFilter] = useState("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedBillingItemIds, setSelectedBillingItemIds] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [restoreProjectId, setRestoreProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "warning" | "error" } | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectClientId, setNewProjectClientId] = useState("");
  const [newProjectDate, setNewProjectDate] = useState(TODAY);
  const [newProjectError, setNewProjectError] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemType, setItemType] = useState("Design");
  const [itemQuantity, setItemQuantity] = useState("1");
  const [itemUnitPrice, setItemUnitPrice] = useState("");
  const [itemError, setItemError] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(TODAY);
  const [invoiceError, setInvoiceError] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [clientError, setClientError] = useState("");
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingClientName, setEditingClientName] = useState("");

  const t = (key: TranslationKey) => ui[language][key];

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("cijd.language") as Language | null;
    const savedTheme = window.localStorage.getItem("cijd.theme") as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (savedLanguage === "ja" || savedLanguage === "en") setLanguage(savedLanguage);
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    else if (prefersDark) setTheme("dark");
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    repositoryRef.current.save(snapshot);
  }, [snapshot, isReady]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (isReady) window.localStorage.setItem("cijd.theme", theme);
  }, [theme, isReady]);

  useEffect(() => {
    if (isReady) {
      window.localStorage.setItem("cijd.language", language);
      document.documentElement.lang = language;
    }
  }, [language, isReady]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const visibleClients = snapshot.clients.filter((client) => client.active || client.id === clientFilter);
  const filteredClientId = clientFilter === "all" ? null : clientFilter;
  const visibleProjects = snapshot.projects.filter((project) => {
    const clientMatch = !filteredClientId || project.clientId === filteredClientId;
    const searchMatch = !projectSearch.trim() || `${project.name} ${snapshot.clients.find((client) => client.id === project.clientId)?.name ?? ""}`.toLowerCase().includes(projectSearch.toLowerCase());
    return clientMatch && searchMatch;
  });
  const currentProject = snapshot.projects.find((project) => project.id === selectedProjectId) ?? null;
  const currentProjectItems = currentProject ? snapshot.billingItems.filter((item) => item.projectId === currentProject.id) : [];
  const currentProjectIsArchived = currentProject ? projectStatus(currentProject.id, snapshot.billingItems) === "PAID" : false;

  const filteredItems = snapshot.billingItems.filter((item) => {
    const project = snapshot.projects.find((candidate) => candidate.id === item.projectId);
    return Boolean(project && (!filteredClientId || project.clientId === filteredClientId));
  });
  const readyItems = filteredItems.filter((item) => item.status === "READY_TO_INVOICE");
  const reviewItems = filteredItems.filter((item) => item.status === "NEEDS_REVIEW");
  const progressItems = filteredItems.filter((item) => item.status === "IN_PROGRESS");
  const awaitingInvoices = snapshot.invoices.filter((invoice) => invoice.status === "OPEN" && (!filteredClientId || invoice.clientId === filteredClientId));
  const receiptInvoices = snapshot.invoices.filter((invoice) => invoice.receiptStatus === "PENDING" && (!filteredClientId || invoice.clientId === filteredClientId));

  const archiveClientId = archiveClientFilter === "all" ? null : archiveClientFilter;
  const archiveProjects = snapshot.projects.filter((project) => {
    const items = snapshot.billingItems.filter((item) => item.projectId === project.id);
    const clientMatch = (!filteredClientId || project.clientId === filteredClientId) && (!archiveClientId || project.clientId === archiveClientId);
    const searchMatch = !archiveSearch.trim() || `${project.name} ${snapshot.clients.find((client) => client.id === project.clientId)?.name ?? ""}`.toLowerCase().includes(archiveSearch.toLowerCase());
    const monthMatch = !archiveMonth || project.date.startsWith(archiveMonth);
    return items.length > 0 && items.every((item) => item.status === "PAID") && clientMatch && searchMatch && monthMatch;
  });

  const selectedItems = snapshot.billingItems.filter((item) => selectedBillingItemIds.includes(item.id) && item.status === "READY_TO_INVOICE");
  const selectedClientIds = Array.from(new Set(selectedItems.map((item) => snapshot.projects.find((project) => project.id === item.projectId)?.clientId).filter((clientId): clientId is string => Boolean(clientId))));
  const selectedTotal = selectedItems.reduce((total, item) => total + item.amount, 0);
  const clientName = (clientId: string) => snapshot.clients.find((client) => client.id === clientId)?.name ?? "—";

  const mutateSnapshot = (mutator: (next: BillingSnapshot) => void) => {
    setSnapshot((current) => {
      const next = cloneSnapshot(current);
      mutator(next);
      return next;
    });
  };

  const notify = (message: string, tone: "success" | "warning" | "error" = "success") => setToast({ message, tone });

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setItemError("");
  };

  const resetNewProject = () => {
    setNewProjectName("");
    setNewProjectClientId(clientFilter !== "all" ? clientFilter : snapshot.clients.find((client) => client.active)?.id ?? "");
    setNewProjectDate(TODAY);
    setNewProjectError("");
  };

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newProjectName.trim()) return setNewProjectError(t("projectNameRequired"));
    if (!newProjectClientId) return setNewProjectError(t("clientRequired"));
    const now = new Date().toISOString();
    const project: Project = {
      id: makeId("project"), clientId: newProjectClientId, name: newProjectName.trim(), date: newProjectDate || TODAY,
      createdAt: now, createdBy: CURRENT_USER, updatedAt: now, updatedBy: CURRENT_USER,
    };
    mutateSnapshot((next) => next.projects.unshift(project));
    setModal(null);
    notify(t("projectCreated"));
    setSelectedProjectId(project.id);
  };

  const handleAddItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentProject) return;
    const quantity = Number(itemQuantity);
    const unitPrice = Number(itemUnitPrice);
    if (!itemDescription.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return setItemError(language === "ja" ? "内容・数量・単価を正しく入力してください。" : "Enter a description, positive quantity, and valid unit price.");
    }
    const now = new Date().toISOString();
    const newItem: BillingItem = {
      id: makeId("item"), projectId: currentProject.id, description: itemDescription.trim(), type: itemType || "Custom",
      quantity, unitPrice, amount: Math.round(quantity * unitPrice * 100) / 100, status: "READY_TO_INVOICE",
      createdAt: now, createdBy: CURRENT_USER, updatedAt: now, updatedBy: CURRENT_USER,
    };
    mutateSnapshot((next) => {
      next.billingItems.push(newItem);
      const project = next.projects.find((candidate) => candidate.id === currentProject.id);
      if (project) { project.updatedAt = now; project.updatedBy = CURRENT_USER; }
    });
    setItemDescription("");
    setItemType("Design");
    setItemQuantity("1");
    setItemUnitPrice("");
    setItemError("");
    notify(language === "ja" ? "請求項目を追加しました" : "Billing item added");
  };

  const toggleBillingItem = (itemId: string) => {
    setSelectedBillingItemIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  };

  const openInvoiceModal = () => {
    if (!selectedItems.length) return notify(t("selectItems"), "warning");
    if (selectedClientIds.length > 1) return notify(t("oneClientOnly"), "warning");
    setInvoiceNumber("");
    setInvoiceDate(TODAY);
    setInvoiceError("");
    setModal("invoice");
  };

  const handleCreateInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedNumber = invoiceNumber.trim().toLowerCase();
    if (!normalizedNumber) return setInvoiceError(t("invoiceNumberRequired"));
    if (snapshot.invoices.some((invoice) => invoice.invoiceNumber.trim().toLowerCase() === normalizedNumber)) return setInvoiceError(t("invoiceNumberDuplicate"));
    const currentItems = snapshot.billingItems.filter((item) => selectedBillingItemIds.includes(item.id));
    if (!currentItems.length || currentItems.some((item) => item.status !== "READY_TO_INVOICE")) {
      setInvoiceError(language === "ja" ? "選択した項目の状態が変わりました。画面を更新して再選択してください。" : "A selected item changed state. Refresh the selection and try again.");
      return;
    }
    const clientId = snapshot.projects.find((project) => project.id === currentItems[0].projectId)?.clientId;
    if (!clientId || currentItems.some((item) => snapshot.projects.find((project) => project.id === item.projectId)?.clientId !== clientId)) return setInvoiceError(t("oneClientOnly"));
    const now = new Date().toISOString();
    const invoice: Invoice = { id: makeId("invoice"), clientId, invoiceNumber: invoiceNumber.trim(), invoiceDate: invoiceDate || TODAY, amount: currentItems.reduce((sum, item) => sum + item.amount, 0), status: "OPEN", createdAt: now, receiptStatus: "PENDING" };
    mutateSnapshot((next) => {
      next.invoices.unshift(invoice);
      next.invoiceItems.push(...currentItems.map((item) => ({ invoiceId: invoice.id, billingItemId: item.id })));
      next.billingItems.forEach((item) => { if (currentItems.some((selected) => selected.id === item.id)) { item.status = "INVOICED"; item.updatedAt = now; item.updatedBy = CURRENT_USER; } });
      next.auditLogs.unshift({ id: makeId("audit"), entityType: "INVOICE", entityId: invoice.id, action: "CREATE_AND_INVOICE_ITEMS", createdAt: now, createdBy: CURRENT_USER });
    });
    setModal(null);
    setSelectedBillingItemIds([]);
    notify(t("invoiceCreated"));
  };

  const confirmPayment = (invoiceId: string) => {
    const invoice = snapshot.invoices.find((candidate) => candidate.id === invoiceId);
    if (!invoice) return;
    if (invoice.status === "PAID") return notify(t("paymentAlreadyPaid"), "warning");
    const now = new Date().toISOString();
    const paymentDate = TODAY;
    mutateSnapshot((next) => {
      const target = next.invoices.find((candidate) => candidate.id === invoiceId);
      if (!target || target.status === "PAID") return;
      target.status = "PAID";
      target.paymentDate = paymentDate;
      target.receiptStatus = target.receiptStatus ?? "PENDING";
      next.payments.push({ id: makeId("payment"), invoiceId, paymentDate, createdAt: now, createdBy: CURRENT_USER });
      const itemIds = next.invoiceItems.filter((item) => item.invoiceId === invoiceId).map((item) => item.billingItemId);
      next.billingItems.forEach((item) => { if (itemIds.includes(item.id)) { item.status = "PAID"; item.updatedAt = now; item.updatedBy = CURRENT_USER; } });
      next.auditLogs.unshift({ id: makeId("audit"), entityType: "PAYMENT", entityId: invoiceId, action: "CONFIRM_PAYMENT", createdAt: now, createdBy: CURRENT_USER });
    });
    notify(t("paymentConfirmed"));
  };

  const markReceiptReceived = (invoiceId: string) => {
    mutateSnapshot((next) => {
      const invoice = next.invoices.find((candidate) => candidate.id === invoiceId);
      if (invoice) invoice.receiptStatus = "RECEIVED";
    });
    notify(t("receiptMarked"));
  };

  const handleAddClient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newClientName.trim()) return setClientError(t("clientNameRequired"));
    mutateSnapshot((next) => next.clients.push({ id: makeId("client"), name: newClientName.trim(), active: true, createdAt: new Date().toISOString() }));
    setNewClientName("");
    setClientError("");
    notify(t("clientAdded"));
  };

  const saveClientName = (clientId: string) => {
    if (!editingClientName.trim()) return setClientError(t("clientNameRequired"));
    mutateSnapshot((next) => { const client = next.clients.find((candidate) => candidate.id === clientId); if (client) client.name = editingClientName.trim(); });
    setEditingClientId(null);
    setEditingClientName("");
    setClientError("");
    notify(t("clientUpdated"));
  };

  const toggleClientActive = (clientId: string) => mutateSnapshot((next) => { const client = next.clients.find((candidate) => candidate.id === clientId); if (client) client.active = !client.active; });

  const restoreArchive = () => {
    if (!restoreProjectId) return;
    const now = new Date().toISOString();
    mutateSnapshot((next) => {
      next.billingItems.forEach((item) => { if (item.projectId === restoreProjectId && item.status === "PAID") { item.status = "NEEDS_REVIEW"; item.updatedAt = now; item.updatedBy = CURRENT_USER; } });
      next.auditLogs.unshift({ id: makeId("audit"), entityType: "PROJECT", entityId: restoreProjectId, action: "RESTORE_TO_REVIEW", createdAt: now, createdBy: CURRENT_USER });
    });
    setModal(null);
    setRestoreProjectId(null);
    notify(t("restored"), "warning");
  };

  const resetLocalData = () => {
    const fresh = cloneSnapshot(initialSnapshot);
    window.localStorage.removeItem("cijd-design-billing.snapshot.v1");
    setSnapshot(fresh);
    notify(t("resetDone"));
  };

  const statusText = (status: BillingStatus) => t(statusLabels[status]);
  const navItems: { id: View; label: TranslationKey; icon: string }[] = [
    { id: "today", label: "today", icon: "today" },
    { id: "projects", label: "projects", icon: "projects" },
    { id: "billing", label: "billing", icon: "billing" },
    { id: "archive", label: "archive", icon: "archive" },
  ];

  return (
    <div className="app-shell">
      <aside className="side-rail" aria-label="Primary navigation">
        <div className="brand-lockup"><span className="brand-mark">C</span><span><strong>CIJD</strong><small>DESIGN</small></span></div>
        <div className="service-name"><span>Billing</span><span className="live-dot" aria-label="Local mode" /></div>
        <div className="rail-rule" />
        <nav className="main-nav">
          {navItems.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "is-active" : ""}`} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon} /><span>{t(item.label)}</span>{item.id === "billing" && readyItems.length > 0 ? <b className="nav-count">{readyItems.length}</b> : null}</button>)}
        </nav>
        <div className="rail-spacer" />
        <div className="rail-meta"><span className="eyebrow">{t("localMode")}</span><span>{t("savedLocally")}</span></div>
        <button className="rail-client-button" onClick={() => { setClientError(""); setModal("clients"); }}><span className="avatar avatar-small">HK</span><span><strong>Hiroki</strong><small>Owner</small></span><Icon name="chevron" size={15} /></button>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">C</span><strong>CIJD</strong><span className="mobile-slash">/</span><span>Billing</span></div>
          <div className="topbar-actions">
            <label className="client-control"><span className="sr-only">{t("client")}</span><span className="client-label">{t("client")}</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label={t("client")}><option value="all">{t("allClients")}</option>{snapshot.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <div className="segmented-control" aria-label="Appearance">
              <button className={theme === "light" ? "is-selected" : ""} onClick={() => setTheme("light")} aria-pressed={theme === "light"} title={t("light")}><Icon name="sun" size={15} /><span className="segmented-label">{t("light")}</span></button>
              <button className={theme === "dark" ? "is-selected" : ""} onClick={() => setTheme("dark")} aria-pressed={theme === "dark"} title={t("dark")}><Icon name="moon" size={15} /><span className="segmented-label">{t("dark")}</span></button>
            </div>
            <div className="language-toggle" role="group" aria-label="Language"><button className={language === "ja" ? "is-selected" : ""} onClick={() => setLanguage("ja")} aria-pressed={language === "ja"}>JA</button><button className={language === "en" ? "is-selected" : ""} onClick={() => setLanguage("en")} aria-pressed={language === "en"}>EN</button></div>
            <button className="icon-button client-add-button" onClick={() => { setClientError(""); setModal("clients"); }} title={t("addClient")} aria-label={t("addClient")}><Icon name="plus" size={18} /></button>
            <span className="avatar">HK</span>
          </div>
        </header>

        <div className="content-shell">
          {view === "today" && <TodayView t={t} formatAmount={(amount) => formatAmount(amount, language)} formatDate={(date) => formatDate(date, language)} clients={snapshot.clients} projects={snapshot.projects} items={snapshot.billingItems} invoices={snapshot.invoices} reviewItems={reviewItems} readyItems={readyItems} progressItems={progressItems} awaitingInvoices={awaitingInvoices} statusText={statusText} openProject={openProject} setView={setView} />}
          {view === "projects" && <ProjectsView t={t} formatAmount={(amount) => formatAmount(amount, language)} formatDate={(date) => formatDate(date, language)} projects={visibleProjects} clients={snapshot.clients} items={snapshot.billingItems} search={projectSearch} setSearch={setProjectSearch} openProject={openProject} openNewProject={() => { resetNewProject(); setModal("new-project"); }} statusText={statusText} />}
          {view === "billing" && <BillingView t={t} tab={billingTab} setTab={setBillingTab} readyItems={readyItems} awaitingInvoices={awaitingInvoices} receiptInvoices={receiptInvoices} projects={snapshot.projects} clients={snapshot.clients} items={snapshot.billingItems} invoices={snapshot.invoices} selectedIds={selectedBillingItemIds} toggleItem={toggleBillingItem} selectedTotal={selectedTotal} selectedClientIds={selectedClientIds} openProject={openProject} formatAmount={(amount) => formatAmount(amount, language)} formatDate={(date) => formatDate(date, language)} statusText={statusText} openInvoiceModal={openInvoiceModal} confirmPayment={confirmPayment} markReceiptReceived={markReceiptReceived} />}
          {view === "archive" && <ArchiveView t={t} projects={archiveProjects} clients={snapshot.clients} items={snapshot.billingItems} invoices={snapshot.invoices} invoiceItems={snapshot.invoiceItems} search={archiveSearch} setSearch={setArchiveSearch} month={archiveMonth} setMonth={setArchiveMonth} clientFilter={archiveClientFilter} setClientFilter={setArchiveClientFilter} openProject={openProject} formatAmount={(amount) => formatAmount(amount, language)} formatDate={(date) => formatDate(date, language)} clearFilters={() => { setArchiveSearch(""); setArchiveMonth(""); setArchiveClientFilter("all"); }} />}
        </div>
        <footer className="app-footer"><span>CIJD DESIGN Billing</span><span>{t("localMode")} · {TODAY}</span><button onClick={resetLocalData}>{t("resetLocal")}</button></footer>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.map((item) => <button key={item.id} className={view === item.id ? "is-active" : ""} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon} size={19} /><span>{t(item.label)}</span>{item.id === "billing" && readyItems.length > 0 ? <b>{readyItems.length}</b> : null}</button>)}</nav>

      {selectedProjectId && currentProject ? <ProjectPanel t={t} project={currentProject} clientName={clientName(currentProject.clientId)} items={currentProjectItems} archived={currentProjectIsArchived} open={Boolean(selectedProjectId)} onClose={() => setSelectedProjectId(null)} formatAmount={(amount) => formatAmount(amount, language)} formatDate={(date) => formatDate(date, language)} statusText={statusText} onAddItem={handleAddItem} itemDescription={itemDescription} setItemDescription={setItemDescription} itemType={itemType} setItemType={setItemType} itemQuantity={itemQuantity} setItemQuantity={setItemQuantity} itemUnitPrice={itemUnitPrice} setItemUnitPrice={setItemUnitPrice} itemError={itemError} onRestore={() => { setRestoreProjectId(currentProject.id); setModal("restore"); }} /> : null}

      {modal === "new-project" && <ModalShell title={t("newProject")} onClose={() => setModal(null)}><form className="form-stack" onSubmit={handleCreateProject}><Field label={t("projectName")} error={newProjectError}><input autoFocus value={newProjectName} onChange={(event) => { setNewProjectName(event.target.value); setNewProjectError(""); }} placeholder={language === "ja" ? "案件名を入力" : "Enter project name"} /></Field><Field label={t("client")}><select value={newProjectClientId} onChange={(event) => setNewProjectClientId(event.target.value)}>{snapshot.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field><Field label={t("date")}><input type="date" value={newProjectDate} onChange={(event) => setNewProjectDate(event.target.value)} /></Field><p className="form-note">{t("savedLocally")}</p><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" type="submit">{t("createProject")} <Icon name="arrow" size={16} /></button></div></form></ModalShell>}

      {modal === "invoice" && <ModalShell title={t("createInvoice")} onClose={() => setModal(null)}><form className="form-stack" onSubmit={handleCreateInvoice}><div className="invoice-summary"><div><span className="eyebrow">{t("selectedForInvoice")}</span><strong>{selectedItems.length} {t("items")}</strong><span>{selectedClientIds[0] ? clientName(String(selectedClientIds[0])) : "—"}</span></div><strong className="invoice-summary-total">{formatAmount(selectedTotal, language)}</strong></div><div className="compact-item-list">{selectedItems.map((item) => <div key={item.id}><span>{item.description}</span><strong>{formatAmount(item.amount, language)}</strong></div>)}</div><Field label={t("invoiceNumber")} error={invoiceError}><input autoFocus value={invoiceNumber} onChange={(event) => { setInvoiceNumber(event.target.value); setInvoiceError(""); }} placeholder="CIJD-YYYY-MM-###" aria-invalid={Boolean(invoiceError)} /></Field><Field label={t("invoiceDate")}><input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></Field><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" type="submit">{t("markAsInvoiced")} <Icon name="arrow" size={16} /></button></div></form></ModalShell>}

      {modal === "clients" && <ModalShell title={t("clientsHeading")} onClose={() => setModal(null)}><form className="client-create-form" onSubmit={handleAddClient}><Field label={t("clientName")} error={clientError}><input autoFocus value={newClientName} onChange={(event) => { setNewClientName(event.target.value); setClientError(""); }} placeholder={language === "ja" ? "Client名を入力" : "Enter client name"} /></Field><button className="button button-primary" type="submit"><Icon name="plus" size={16} /> {t("addClient")}</button></form><div className="client-list">{snapshot.clients.map((client) => <div className="client-list-row" key={client.id}>{editingClientId === client.id ? <input className="client-edit-input" value={editingClientName} onChange={(event) => setEditingClientName(event.target.value)} aria-label={t("clientName")} /> : <div className="client-list-name"><span className={`client-status-dot ${client.active ? "is-active" : ""}`} /><strong>{client.name}</strong></div>}<div className="client-list-actions">{editingClientId === client.id ? <button className="text-button" onClick={() => saveClientName(client.id)}>{t("save")}</button> : <button className="text-button" onClick={() => { setEditingClientId(client.id); setEditingClientName(client.name); }}>{t("rename")}</button>}<button className="status-toggle" onClick={() => toggleClientActive(client.id)} aria-pressed={client.active}>{client.active ? t("active") : t("inactive")}</button></div></div>)}</div></ModalShell>}

      {modal === "restore" && <ModalShell title={t("restoreHeading")} onClose={() => { setModal(null); setRestoreProjectId(null); }}><div className="confirm-copy"><span className="confirm-icon"><Icon name="alert" size={20} /></span><p>{t("restoreBody")}</p></div><div className="modal-actions"><button className="button button-quiet" onClick={() => { setModal(null); setRestoreProjectId(null); }}>{t("cancel")}</button><button className="button button-primary" onClick={restoreArchive}>{t("restoreConfirm")} <Icon name="arrow" size={16} /></button></div></ModalShell>}

      {toast ? <div className={`toast toast-${toast.tone ?? "success"}`} role="status"><span className="toast-icon"><Icon name={toast.tone === "warning" ? "alert" : toast.tone === "error" ? "close" : "check"} size={16} /></span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label={t("close")}><Icon name="close" size={14} /></button></div> : null}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const fieldId = useId();
  const helperId = `${fieldId}-helper`;
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>, { id: fieldId, "aria-describedby": helperId, "aria-invalid": error ? true : undefined })
    : children;
  return <div className="field"><label className="field-label" htmlFor={fieldId}>{label}</label>{control}<span className={`field-helper ${error ? "has-error" : ""}`} id={helperId}>{error ?? " "}</span></div>;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></div>{children}</section></div>;
}

function TodayView({ t, formatAmount, formatDate, clients, projects, items, invoices, reviewItems, readyItems, progressItems, awaitingInvoices, statusText, openProject, setView }: { t: (key: TranslationKey) => string; formatAmount: (amount: number) => string; formatDate: (date: string) => string; clients: Client[]; projects: Project[]; items: BillingItem[]; invoices: Invoice[]; reviewItems: BillingItem[]; readyItems: BillingItem[]; progressItems: BillingItem[]; awaitingInvoices: Invoice[]; statusText: (status: BillingStatus) => string; openProject: (projectId: string) => void; setView: (view: View) => void }) {
  const stats: { label: TranslationKey; count: number; tone: string }[] = [{ label: "inProgress", count: progressItems.length, tone: "blue" }, { label: "readyToInvoice", count: readyItems.length, tone: "cobalt" }, { label: "awaitingPayment", count: awaitingInvoices.length, tone: "amber" }, { label: "needsReview", count: reviewItems.length, tone: "red" }];
  const actionGroups = [{ label: "needsReview" as TranslationKey, items: reviewItems, icon: "alert" }, { label: "readyToInvoice" as TranslationKey, items: readyItems, icon: "receipt" }];
  return <div className="page page-today"><PageIntro eyebrow={t("todayDate")} title={t("todayHeading")} subheading={t("todaySubheading")} /><section className="summary-strip" aria-label="Summary">{stats.map((stat) => <div className="summary-cell" key={stat.label}><span className={`summary-marker marker-${stat.tone}`} /><span className="summary-label">{t(stat.label)}</span><strong>{stat.count}</strong></div>)}</section><div className="today-layout"><section className="task-column"><div className="section-heading-row"><div><span className="eyebrow">{t("today")}</span><h2>{t("todayHeading")}</h2></div><span className="section-count">{reviewItems.length + readyItems.length + awaitingInvoices.length} {t("items")}</span></div>{actionGroups.map((group) => <div className="task-group" key={group.label}><div className="task-group-heading"><span className="task-group-icon"><Icon name={group.icon} size={16} /></span><h3>{t(group.label)}</h3><span>{group.items.length}</span></div>{group.items.slice(0, 5).map((item) => { const project = projects.find((candidate) => candidate.id === item.projectId); return <button className="task-row" key={item.id} onClick={() => project && openProject(project.id)}><span className={`status-dot status-dot-${item.status.toLowerCase()}`} /><span className="task-main"><strong>{item.description}</strong><span>{project?.name ?? "—"} · {clients.find((client) => client.id === project?.clientId)?.name ?? "—"}</span></span><strong className="task-amount">{formatAmount(item.amount)}</strong><Icon name="chevron" size={16} /></button>; })}{group.items.length > 5 ? <button className="inline-link" onClick={() => setView(group.label === "readyToInvoice" ? "billing" : "projects")}>{t("showAll")} <Icon name="arrow" size={15} /></button> : null}</div>)}{awaitingInvoices.length > 0 ? <div className="task-group"><div className="task-group-heading"><span className="task-group-icon"><Icon name="billing" size={16} /></span><h3>{t("awaitingPayment")}</h3><span>{awaitingInvoices.length}</span></div>{awaitingInvoices.slice(0, 4).map((invoice) => <button className="task-row" key={invoice.id} onClick={() => setView("billing")}><span className="status-dot status-dot-invoiced" /><span className="task-main"><strong>{invoice.invoiceNumber}</strong><span>{clients.find((client) => client.id === invoice.clientId)?.name ?? "—"} · {formatDate(invoice.invoiceDate)}</span></span><strong className="task-amount">{formatAmount(invoice.amount)}</strong><Icon name="chevron" size={16} /></button>)}</div> : null}{reviewItems.length + readyItems.length + awaitingInvoices.length === 0 ? <EmptyState icon="check" title={t("allDone")} body={t("noActions")} /> : null}</section><aside className="today-note"><span className="eyebrow">{t("localMode")}</span><h3>{t("sharedLedger")}</h3><p>{t("sharedLedgerBody")}</p><div className="note-rule" /><div className="note-meta"><span>{items.length} {t("items")}</span><span>{invoices.length} {t("invoice")}</span></div></aside></div></div>;
}

function PageIntro({ eyebrow, title, subheading, action }: { eyebrow: string; title: string; subheading: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subheading}</p></div>{action ? <div className="page-intro-action">{action}</div> : null}</div>;
}

function ProjectsView({ t, formatAmount, formatDate, projects, clients, items, search, setSearch, openProject, openNewProject, statusText }: { t: (key: TranslationKey) => string; formatAmount: (amount: number) => string; formatDate: (date: string) => string; projects: Project[]; clients: Client[]; items: BillingItem[]; search: string; setSearch: (value: string) => void; openProject: (projectId: string) => void; openNewProject: () => void; statusText: (status: BillingStatus) => string }) {
  return <div className="page"><PageIntro eyebrow={`${projects.length} ${t("projects")}`} title={t("projectsHeading")} subheading={t("projectsSubheading")} action={<button className="button button-primary" onClick={openNewProject}><Icon name="plus" size={16} /> {t("newProject")}</button>} /><div className="toolbar"><label className="search-field"><Icon name="search" size={17} /><span className="sr-only">{t("searchProjects")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchProjects")} /></label><span className="toolbar-note">{projects.length} {t("projects")}</span></div>{projects.length ? <div className="project-table" role="table" aria-label={t("projects")}><div className="project-table-head" role="row"><span>{t("date")}</span><span>{t("client")}</span><span>{t("project")}</span><span>{t("status")}</span><span>{t("amount")}</span><span /></div>{projects.map((project) => { const projectItems = items.filter((item) => item.projectId === project.id); const total = projectItems.reduce((sum, item) => sum + item.amount, 0); const status = projectStatus(project.id, items); return <button className="project-row" key={project.id} onClick={() => openProject(project.id)} role="row"><span className="project-date">{formatDate(project.date)}</span><span className="project-client">{clients.find((client) => client.id === project.clientId)?.name ?? "—"}</span><strong className="project-title">{project.name}</strong><span><span className={statusClass(status)}><i />{statusText(status)}</span></span><strong className="project-amount">{formatAmount(total)}</strong><Icon name="chevron" size={17} /></button>; })}</div> : <EmptyState icon="search" title={t("noProjects")} body={t("noProjectsSub")} action={<button className="button button-primary" onClick={openNewProject}><Icon name="plus" size={16} /> {t("newProject")}</button>} />}</div>;
}

function BillingView({ t, tab, setTab, readyItems, awaitingInvoices, receiptInvoices, projects, clients, items, invoices, selectedIds, toggleItem, selectedTotal, selectedClientIds, openProject, formatAmount, formatDate, statusText, openInvoiceModal, confirmPayment, markReceiptReceived }: { t: (key: TranslationKey) => string; tab: BillingTab; setTab: (tab: BillingTab) => void; readyItems: BillingItem[]; awaitingInvoices: Invoice[]; receiptInvoices: Invoice[]; projects: Project[]; clients: Client[]; items: BillingItem[]; invoices: Invoice[]; selectedIds: string[]; toggleItem: (id: string) => void; selectedTotal: number; selectedClientIds: string[]; openProject: (id: string) => void; formatAmount: (amount: number) => string; formatDate: (date: string) => string; statusText: (status: BillingStatus) => string; openInvoiceModal: () => void; confirmPayment: (id: string) => void; markReceiptReceived: (id: string) => void }) {
  const grouped = clients.map((client) => ({ client, rows: readyItems.filter((item) => projects.find((project) => project.id === item.projectId)?.clientId === client.id) })).filter((group) => group.rows.length);
  const tabs: { id: BillingTab; label: TranslationKey; count: number }[] = [{ id: "ready", label: "readyToInvoice", count: readyItems.length }, { id: "awaiting", label: "awaitingPayment", count: awaitingInvoices.length }, { id: "receipt", label: "receiptPending", count: receiptInvoices.length }];
  return <div className="page"><PageIntro eyebrow={t("workflow")} title={t("billingHeading")} subheading={t("billingSubheading")} /><div className="billing-tabs" role="tablist">{tabs.map((tabItem) => <button key={tabItem.id} role="tab" aria-selected={tab === tabItem.id} className={tab === tabItem.id ? "is-active" : ""} onClick={() => setTab(tabItem.id)}><span>{t(tabItem.label)}</span><b>{tabItem.count}</b></button>)}</div>{tab === "ready" ? <div className="billing-workspace"><div className="billing-list"><div className="list-caption"><span>{t("readyList")}</span><span>{readyItems.length} {t("items")}</span></div>{grouped.length ? grouped.map(({ client, rows }) => <section className="client-billing-group" key={client.id}><div className="client-group-heading"><div><span className="eyebrow">{t("client")}</span><h2>{client.name}</h2></div><strong>{formatAmount(rows.reduce((sum, item) => sum + item.amount, 0))}</strong></div>{rows.map((item) => { const project = projects.find((candidate) => candidate.id === item.projectId); const checked = selectedIds.includes(item.id); return <label className={`billing-item-row ${checked ? "is-selected" : ""}`} key={item.id}><input type="checkbox" checked={checked} onChange={() => toggleItem(item.id)} /><span className="custom-check"><Icon name="check" size={14} /></span><span className="billing-item-copy"><strong>{item.description}</strong><span>{project?.name ?? "—"} · {item.type}{item.quantity > 1 ? ` · ×${item.quantity}` : ""}</span></span><strong className="billing-item-amount">{formatAmount(item.amount)}</strong><button className="row-arrow" type="button" onClick={(event) => { event.preventDefault(); if (project) openProject(project.id); }} aria-label={t("openProject")}><Icon name="chevron" size={16} /></button></label>; })}</section>) : <EmptyState icon="check" title={t("noItems")} body={t("noActions")} />}</div><aside className="selection-rail"><span className="eyebrow">{t("selectedForInvoice")}</span><h2>{selectedIds.length ? `${selectedIds.length} ${t("items")}` : t("selectItems")}</h2><div className="selection-amount">{formatAmount(selectedTotal)}</div>{selectedClientIds.length > 1 ? <p className="selection-error"><Icon name="alert" size={15} />{t("oneClientOnly")}</p> : <p>{selectedIds.length ? `${clients.find((client) => client.id === selectedClientIds[0])?.name ?? "—"}` : t("chooseOneClient")}</p>}<button className="button button-primary button-full" disabled={!selectedIds.length || selectedClientIds.length !== 1} onClick={openInvoiceModal}>{t("markAsInvoiced")} <Icon name="arrow" size={16} /></button><span className="selection-footnote">{t("savedLocally")}</span></aside></div> : tab === "awaiting" ? <InvoiceList invoices={awaitingInvoices} clients={clients} title={t("awaitingList")} emptyTitle={t("noAwaiting")} emptyBody={t("noActions")} formatAmount={formatAmount} formatDate={formatDate} actionLabel={t("confirmPayment")} onAction={confirmPayment} statusText={t("awaitingPayment")} paidLabel={t("paid")} invoiceLabel={t("invoice")} amountLabel={t("amount")} dateLabel={t("invoiceDate")} statusLabel={t("status")} /> : <InvoiceList invoices={receiptInvoices} clients={clients} title={t("receiptList")} emptyTitle={t("noReceipt")} emptyBody={t("noActions")} formatAmount={formatAmount} formatDate={formatDate} actionLabel={t("markReceipt")} onAction={markReceiptReceived} statusText={t("receiptPending")} paidLabel={t("paid")} invoiceLabel={t("invoice")} amountLabel={t("amount")} dateLabel={t("invoiceDate")} statusLabel={t("status")} />}</div>;
}

function InvoiceList({ invoices, clients, title, emptyTitle, emptyBody, formatAmount, formatDate, actionLabel, onAction, statusText, paidLabel, invoiceLabel, amountLabel, dateLabel, statusLabel }: { invoices: Invoice[]; clients: Client[]; title: string; emptyTitle: string; emptyBody: string; formatAmount: (amount: number) => string; formatDate: (date: string) => string; actionLabel: string; onAction: (id: string) => void; statusText: string; paidLabel: string; invoiceLabel: string; amountLabel: string; dateLabel: string; statusLabel: string }) {
  return <section className="invoice-list"><div className="list-caption"><span>{title}</span><span>{invoices.length}</span></div>{invoices.length ? <div className="invoice-table">{invoices.map((invoice) => <div className="invoice-row" key={invoice.id}><span className="invoice-number"><strong>{invoice.invoiceNumber}</strong><small>{clients.find((client) => client.id === invoice.clientId)?.name ?? "—"}</small></span><span><small>{dateLabel}</small><strong>{formatDate(invoice.invoiceDate)}</strong></span><span><small>{amountLabel}</small><strong>{formatAmount(invoice.amount)}</strong></span><span><small>{statusLabel}</small><span className={`invoice-state ${invoice.status === "PAID" ? "is-paid" : "is-open"}`}><i />{invoice.status === "PAID" ? paidLabel : statusText}</span></span><button className="button button-outline" onClick={() => onAction(invoice.id)}>{actionLabel}</button></div>)}</div> : <EmptyState icon="check" title={emptyTitle} body={emptyBody} />}</section>;
}

function ArchiveView({ t, projects, clients, items, invoices, invoiceItems, search, setSearch, month, setMonth, clientFilter, setClientFilter, openProject, formatAmount, formatDate, clearFilters }: { t: (key: TranslationKey) => string; projects: Project[]; clients: Client[]; items: BillingItem[]; invoices: Invoice[]; invoiceItems: { invoiceId: string; billingItemId: string }[]; search: string; setSearch: (value: string) => void; month: string; setMonth: (value: string) => void; clientFilter: string; setClientFilter: (value: string) => void; openProject: (id: string) => void; formatAmount: (amount: number) => string; formatDate: (date: string) => string; clearFilters: () => void }) {
  const hasFilters = search || month || clientFilter !== "all";
  return <div className="page"><PageIntro eyebrow={`${projects.length} ${t("completed")}`} title={t("archiveHeading")} subheading={t("archiveSubheading")} /><div className="archive-toolbar"><label className="search-field"><Icon name="search" size={17} /><span className="sr-only">{t("search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("search")} /></label><label className="archive-client-field"><span>{t("client")}</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">{t("allClients")}</option>{clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="month-field"><span>{t("month")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>{hasFilters ? <button className="text-button" onClick={clearFilters}>{t("clearFilters")}</button> : null}</div>{projects.length ? <div className="archive-list"><div className="project-table-head"><span>{t("date")}</span><span>{t("client")}</span><span>{t("project")}</span><span>{t("invoice")}</span><span>{t("amount")}</span><span /></div>{projects.map((project) => { const projectItems = items.filter((item) => item.projectId === project.id); const projectItemIds = new Set(projectItems.map((item) => item.id)); const invoiceNumber = invoices.find((invoice) => invoice.status === "PAID" && invoiceItems.some((link) => link.invoiceId === invoice.id && projectItemIds.has(link.billingItemId)))?.invoiceNumber ?? "—"; const total = projectItems.reduce((sum, item) => sum + item.amount, 0); return <button className="archive-row" key={project.id} onClick={() => openProject(project.id)}><span>{formatDate(project.date)}</span><span>{clients.find((client) => client.id === project.clientId)?.name ?? "—"}</span><strong>{project.name}</strong><span className="archive-invoice">{invoiceNumber}</span><strong>{formatAmount(total)}</strong><Icon name="chevron" size={17} /></button>; })}</div> : <EmptyState icon="archive" title={t("noVerifiedArchive")} body={t("archiveAwaitingData")} action={hasFilters ? <button className="button button-outline" onClick={clearFilters}>{t("clearFilters")}</button> : undefined} />}</div>;
}

function ProjectPanel({ t, project, clientName, items, archived, onClose, formatAmount, formatDate, statusText, onAddItem, itemDescription, setItemDescription, itemType, setItemType, itemQuantity, setItemQuantity, itemUnitPrice, setItemUnitPrice, itemError, onRestore }: { t: (key: TranslationKey) => string; project: Project; clientName: string; items: BillingItem[]; archived: boolean; open: boolean; onClose: () => void; formatAmount: (amount: number) => string; formatDate: (date: string) => string; statusText: (status: BillingStatus) => string; onAddItem: (event: FormEvent<HTMLFormElement>) => void; itemDescription: string; setItemDescription: (value: string) => void; itemType: string; setItemType: (value: string) => void; itemQuantity: string; setItemQuantity: (value: string) => void; itemUnitPrice: string; setItemUnitPrice: (value: string) => void; itemError: string; onRestore: () => void }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const status = projectStatus(project.id, items);
  return <div className="panel-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="detail-panel" role="dialog" aria-modal="true" aria-label={project.name}><div className="panel-header"><div><span className="eyebrow">{clientName}</span><h2>{project.name}</h2></div><button className="icon-button" onClick={onClose} aria-label={t("close")}><Icon name="close" size={18} /></button></div><div className="panel-meta"><span>{formatDate(project.date)}</span><span className={statusClass(status)}><i />{statusText(status)}</span><strong>{formatAmount(total)}</strong></div><div className="panel-body"><div className="panel-section-label"><span>{t("items")}</span><span>{items.length}</span></div><div className="detail-items">{items.length ? items.map((item) => <div className="detail-item" key={item.id}><div><strong>{item.description}</strong><span>{item.type}{item.quantity > 1 ? ` · ×${item.quantity}` : ""}</span></div><div><strong>{formatAmount(item.amount)}</strong><span className={statusClass(item.status)}><i />{statusText(item.status)}</span></div></div>) : <p className="detail-empty">{t("noItems")}</p>}</div>{archived ? <div className="archived-note"><Icon name="lock" size={16} /><span>{t("archivedReadOnly")}</span></div> : <form className="add-item-form" onSubmit={onAddItem}><div className="panel-section-label"><span>{t("addItem")}</span><span>{t("newItem")}</span></div><div className="add-item-grid"><Field label={t("description")} error={itemError}><input value={itemDescription} onChange={(event) => setItemDescription(event.target.value)} placeholder={t("description")} /></Field><Field label={t("type")}><select value={itemType} onChange={(event) => setItemType(event.target.value)}><option>Design</option><option>Resize</option><option>Print</option><option>Custom</option></select></Field><Field label={t("quantity")}><input type="number" min="1" step="1" value={itemQuantity} onChange={(event) => setItemQuantity(event.target.value)} /></Field><Field label={t("unitPrice")}><input type="number" min="0" step="0.01" value={itemUnitPrice} onChange={(event) => setItemUnitPrice(event.target.value)} placeholder="0.00" /></Field></div><button className="button button-outline" type="submit"><Icon name="plus" size={16} /> {t("addItem")}</button></form>}{archived ? <button className="restore-link" onClick={onRestore}><Icon name="arrow" size={15} /> {t("restore")}</button> : null}</div><div className="panel-footer"><span>{t("savedLocally")}</span><span>{t("updated")} {formatDate(project.updatedAt.slice(0, 10))}</span></div></aside></div>;
}

function EmptyState({ icon, title, body, action }: { icon: string; title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={20} /></span><h3>{title}</h3><p>{body}</p>{action ? action : null}</div>;
}
