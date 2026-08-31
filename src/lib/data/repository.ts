import type {
  BillingStatus,
  Client,
  BillingItem,
  Invoice,
  ItemType,
  Notification,
  Project,
  ReceiptStatus,
  Snapshot,
  TelegramSession,
  User,
} from "@/lib/types";

/** Thrown for rule violations we want to show the user as a plain sentence. */
export class RuleError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "RuleError";
  }
}

export interface CreateProjectInput {
  clientId: string;
  name: string;
  createdBy?: string;
  /** Optional — the server fills in today's date when omitted (Telegram path). */
  date?: string;
  note?: string;
}

export interface CreateBillingItemInput {
  projectId: string;
  description: string;
  type?: ItemType;
  quantity?: number;
  unitPrice?: number;
  /** Custom price. When present it wins over quantity x unitPrice. */
  amount?: number;
  billingStatus?: BillingStatus;
  note?: string;
  printSize?: string;
  priceSource?: string;
  priceReason?: string;
  actor?: string;
}

export interface UpdateBillingItemInput {
  description?: string;
  type?: ItemType;
  quantity?: number;
  unitPrice?: number;
  amount?: number | null;
  note?: string;
  printSize?: string;
  actor?: string;
}

export interface UpdatePrintSpecInput {
  description?: string;
  printSize?: string;
  quantity?: number;
  note?: string;
  actor?: string;
}

export interface ReviewPrintPriceInput {
  unitPrice: number;
  amount: number;
  confirm?: boolean;
  priceSource?: string;
  priceReason?: string;
  actor?: string;
}

export interface CreateInvoiceInput {
  clientId: string;
  invoiceNumber: string;
  invoiceDate: string;
  billingItemIds: string[];
  actor?: string;
}

export interface ConfirmPaymentInput {
  paymentDate: string;
  slip?: string;
  actor?: string;
}

/**
 * The only surface the app uses to reach data. Swap the implementation
 * (see src/lib/data/index.ts) to move from the local store to Supabase.
 */
export interface Repository {
  readonly mode: "local" | "supabase";
  getSnapshot(): Promise<Snapshot>;
  /** Identity lookup only — never used to answer a request for data. */
  rawUsers(): Promise<User[]>;

  createClient(input: { name: string; actor?: string }): Promise<Client>;
  updateClient(
    id: string,
    patch: { name?: string; active?: boolean; actor?: string },
  ): Promise<Client>;

  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(
    id: string,
    patch: { name?: string; date?: string; note?: string; clientId?: string; actor?: string },
  ): Promise<Project>;

  createBillingItem(input: CreateBillingItemInput): Promise<BillingItem>;
  updateBillingItem(id: string, patch: UpdateBillingItemInput): Promise<BillingItem>;
  updatePrintSpec(id: string, patch: UpdatePrintSpecInput): Promise<BillingItem>;
  reviewPrintPrice(id: string, input: ReviewPrintPriceInput): Promise<BillingItem>;
  setBillingStatus(
    id: string,
    status: BillingStatus,
    actor?: string,
  ): Promise<BillingItem>;
  /** The production gate: only delivered or completed work becomes ready to invoice. */
  setItemDelivery(id: string, delivered: boolean, actor?: string): Promise<BillingItem>;
  /** Completes a creative item; PRINT items must use setItemDelivery instead. */
  setItemCompletion(id: string, completed: boolean, actor?: string): Promise<BillingItem>;
  setProjectDelivery(
    projectId: string,
    delivered: boolean,
    actor?: string,
  ): Promise<BillingItem[]>;
  deleteBillingItem(id: string, actor?: string): Promise<void>;

  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  voidInvoice(id: string, actor?: string): Promise<Invoice>;
  confirmPayment(id: string, input: ConfirmPaymentInput): Promise<Invoice>;
  revertPayment(id: string, actor?: string): Promise<Invoice>;
  setReceiptStatus(id: string, status: ReceiptStatus, actor?: string): Promise<Invoice>;

  /** Returns null when an identical notification was already recorded. */
  queueNotification(input: {
    kind: "DELIVERY";
    dedupeKey: string;
    projectId: string;
    text: string;
  }): Promise<Notification | null>;
  markNotification(
    id: string,
    status: "SENT" | "FAILED" | "SKIPPED",
    error?: string,
  ): Promise<Notification>;
  listNotifications(): Promise<Notification[]>;
  getNotification(id: string): Promise<Notification | null>;

  getTelegramSession(chatId: string): Promise<TelegramSession | null>;
  saveTelegramSession(session: TelegramSession): Promise<TelegramSession>;
}
