import { supabaseServerClient } from "@/lib/supabase/server";
import { RuleError } from "@/lib/data";
import { isLocalDemoRuntime } from "@/lib/runtime";
import { NextResponse } from "next/server";
import { V4TaxInvoiceRepository } from "./repository";

export async function v4Repo(): Promise<V4TaxInvoiceRepository> {
  if (isLocalDemoRuntime) throw new RuleError("DEMO_MODE", "V4 persistence requires the Preview database.", 404);
  const client = await supabaseServerClient();
  if (!client) throw new RuleError("SUPABASE_UNAVAILABLE", "V4 Preview persistence is unavailable.", 503);
  return new V4TaxInvoiceRepository(client);
}

export async function v4Handle<T>(work: () => Promise<T>): Promise<NextResponse> {
  try { return NextResponse.json({ ok: true, data: await work() }); }
  catch (error) { console.error("[v4-api]", error); return NextResponse.json({ ok: false, code: "V4_ERROR", message: error instanceof Error ? error.message : "V4 request failed." }, { status: error instanceof RuleError ? error.status : 400 }); }
}
