import { isAuthorized } from "@/server/auth";
import { PrintInvoice } from "@/ui/print-invoice";

export const dynamic = "force-dynamic";

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return <main className="access-page"><section className="access-card"><h1>Preview access required</h1></section></main>;
  const { id } = await params;
  return <PrintInvoice invoiceId={id} />;
}
