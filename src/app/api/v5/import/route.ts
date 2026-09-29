import { importGET, importPOST } from "@/lib/billing-v5/import-endpoint";

export const dynamic = "force-dynamic";

/** The one-time V3 → V5 import; see src/lib/billing-v5/import-endpoint.ts. */
export const GET = importGET;
export const POST = importPOST;
