import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { handle, readJson, str } from "@/lib/api";
import { RuleError } from "@/lib/data";
import { autoInvoiceNumber } from "@/lib/data/repository";
import { ExchangeRateUnavailableError } from "@/lib/exchange-rate";
import { ensureCurrentSupabaseExchangeRate } from "@/lib/exchange-rate-server";
import { supabaseConfig } from "@/lib/supabase/config";
import { supabaseServerClient } from "@/lib/supabase/server";
import { toInvoice } from "@/lib/supabase/rows";
import type { Invoice, PltFormat } from "@/lib/types";

const ALLOWED = new Set(["BILLING", "ADMIN"]);
const PLT = new Set<PltFormat>(["NORMAL", "IMPORT_PRODUCT", "DISTRIBUTOR"]);

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." }, { status: 401 });
  }
  if (!ALLOWED.has(user.role)) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "You do not have access to this." }, { status: 403 });
  }

  const body = await readJson(request);
  const ids = Array.isArray(body.billingItemIds)
    ? body.billingItemIds.filter((value): value is string => typeof value === "string")
    : [];
  const clientId = str(body.clientId)?.trim() ?? "";
  const invoiceDate = str(body.invoiceDate)?.trim() ?? "";
  const invoiceNumber = str(body.invoiceNumber)?.trim() || autoInvoiceNumber();
  const poNumber = str(body.poNumber)?.trim() ?? "";
  const showParentCompany = body.showParentCompany === true;
  const parentCompanyName = str(body.parentCompanyName)?.trim() ?? "";
  const pltFormat = (str(body.pltFormat)?.trim().toUpperCase() || "NORMAL") as PltFormat;
  const stateChargeVat = body.stateChargeVat === true;
  const noVat = body.noVat === true;
  const customerNote = str(body.customerNote)?.trim() ?? "";
  const staffNote = str(body.staffNote)?.trim() ?? "";

  return handle(async () => {
    if (!clientId || !ids.length) throw new RuleError("INVALID", "Select at least one item.", 400);
    if (!PLT.has(pltFormat)) throw new RuleError("INVALID", "PLT Format is invalid.", 400);
    if (stateChargeVat && noVat) {
      throw new RuleError("INVALID", "State Charge VAT and No VAT cannot both be enabled.", 400);
    }
    if (showParentCompany && !parentCompanyName) {
      throw new RuleError("INVALID", "Parent company name is required when it is shown in the PDF.", 400);
    }

    const client = await supabaseServerClient();
    if (!client) throw new RuleError("OFFLINE", "Database is unavailable.", 503);
    const config = supabaseConfig();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const rateClient = config && serviceKey
      ? createClient(config.url, serviceKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } })
      : client;
    try {
      await ensureCurrentSupabaseExchangeRate(rateClient);
    } catch (error) {
      if (error instanceof ExchangeRateUnavailableError) {
        throw new RuleError("EXCHANGE_RATE_UNAVAILABLE", error.message, 503);
      }
      throw error;
    }

    const result = await client.rpc("create_invoice_with_options", {
      p_client_id: clientId,
      p_invoice_number: invoiceNumber,
      p_invoice_date: invoiceDate || null,
      p_item_ids: ids,
      p_po_number: poNumber || null,
      p_show_parent_company: showParentCompany,
      p_parent_company_name: parentCompanyName || null,
      p_plt_format: pltFormat,
      p_state_charge_vat: stateChargeVat,
      p_no_vat: noVat,
      p_customer_note: customerNote || null,
      p_staff_note: staffNote || null,
      p_actor: user.name,
    });
    if (result.error) {
      const code = result.error.message?.trim() || "INTERNAL";
      const status = code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : code === "EXCHANGE_RATE_UNAVAILABLE" ? 503 : 409;
      throw new RuleError(code, result.error.details || result.error.message || code, status);
    }
    return toInvoice(result.data as Record<string, unknown>) as Invoice;
  });
}
