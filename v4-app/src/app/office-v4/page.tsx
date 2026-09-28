import { isAuthorized } from "@/server/auth";
import { Dashboard } from "@/ui/dashboard";

export const dynamic = "force-dynamic";

export default async function OfficeV4Page() {
  if (!(await isAuthorized())) {
    return (
      <main className="access-page">
        <section className="access-card">
          <p className="eyebrow">CIJD DESIGN</p>
          <h1>Preview access required</h1>
          <p>Open the private V4 access link to continue.</p>
        </section>
      </main>
    );
  }
  return <Dashboard />;
}
