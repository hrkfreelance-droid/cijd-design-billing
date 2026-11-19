import { CustomerActivity } from "@/components/billing-v5/office-pages";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerActivity id={id} />;
}
