import type {
  BillingStatus,
  Client,
  BillingItem,
  Invoice,
  ItemType,
  Project,
  ReceiptStatus,
  Snapshot,
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
  /** Optional — the server fills in today's date when omitted. */
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
  /** The Designer explicitly accepted a changed price while editing. */
  confirmPrice?: boolean;
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
  /** Optional compatibility input for imported/internal callers. The UI never asks for it. */
  invoiceNumber?: string;
  invoiceDate: string;
  billingItemIds: string[];
  actor?: string;
}

/** Internal invoice reference. User-facing billing no longer asks for a number. */
export function autoInvoiceNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `CIJD-${date}-${suffix}`;
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

}
