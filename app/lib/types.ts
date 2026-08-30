export type BillingStatus =
  | "IN_PROGRESS"
  | "READY_TO_INVOICE"
  | "INVOICED"
  | "PAID"
  | "NEEDS_REVIEW";

export type InvoiceStatus = "OPEN" | "PAID";
export type ReceiptStatus = "PENDING" | "RECEIVED";

export type Client = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
};

export type User = {
  id: string;
  name: string;
  role: "Hiroki" | "Billing Staff" | "Accounting";
  active: boolean;
};

export type Project = {
  id: string;
  clientId: string;
  name: string;
  date: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type BillingItem = {
  id: string;
  projectId: string;
  description: string;
  type: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  status: BillingStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type Invoice = {
  id: string;
  clientId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  status: InvoiceStatus;
  createdAt: string;
  paymentDate?: string;
  paymentSlip?: string;
  receiptStatus: ReceiptStatus;
};

export type InvoiceItem = {
  invoiceId: string;
  billingItemId: string;
};

export type Payment = {
  id: string;
  invoiceId: string;
  paymentDate: string;
  createdAt: string;
  createdBy: string;
};

export type AuditLog = {
  id: string;
  entityType: "PROJECT" | "BILLING_ITEM" | "INVOICE" | "PAYMENT";
  entityId: string;
  action: string;
  createdAt: string;
  createdBy: string;
};

export type BillingSnapshot = {
  users: User[];
  clients: Client[];
  projects: Project[];
  billingItems: BillingItem[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  payments: Payment[];
  auditLogs: AuditLog[];
};
