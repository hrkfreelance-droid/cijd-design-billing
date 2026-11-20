"use client";

import { Popover } from "@base-ui/react/popover";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MoonIcon, SearchIcon, SunIcon } from "@/components/icons";
import { useData, useI18n, useSession, useTheme } from "@/components/providers";
import { canAny, homeFor } from "@/lib/auth/roles";
import { buildProjectViews, pricingCustomerCandidates, matchesSearch, normalizeSearch, projectMatches, type ProjectView } from "@/lib/billing-v5/project-view";
import { useWorkspaceT } from "@/lib/billing-v5/workspace-i18n";
import { BILLING, projectHref, WorkspaceState } from "./workspace-parts";

const sections = [
  { key: "design", suffix: "" },
  { key: "accounting", suffix: "/accounting" },
  { key: "customers", suffix: "/customers" },
  { key: "archive", suffix: "/archive" },
] as const;

const ProjectContext = createContext<ProjectView[]>([]);
export const useProjectViews = () => useContext(ProjectContext);

const PricingCustomerContext = createContext<ReturnType<typeof pricingCustomerCandidates>>([]);
export const usePricingCustomerCandidates = () => useContext(PricingCustomerContext);

function Navigation() {
  const path = usePathname();
  const source = useSearchParams().get("source");
  const t = useWorkspaceT();
  const isProjects = path.startsWith(`${BILLING}/projects`);
  const activeTab = path === BILLING || (isProjects && source === "design") ? "design"
    : path.startsWith(`${BILLING}/customers`) ? "customers"
    : path.startsWith(`${BILLING}/accounting`) || path.startsWith(`${BILLING}/tax-invoices`) ? "accounting"
    : "archive";
  return (
    <nav className="bw-top-tabs" aria-label={t("billingNavigation")} data-layout-group>
      {sections.map(({ key, suffix }) => (
        <Link href={BILLING + suffix} key={key} aria-current={activeTab === key ? "page" : undefined}>{t(key)}</Link>
      ))}
    </nav>
  );
}

function GlobalSearch({ projects }: { projects: ProjectView[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { snapshot } = useData();
  const t = useWorkspaceT();
  const { t: common } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!dialog.current?.open) dialog.current?.showModal();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim();
  const results = needle ? projects.filter((project) => !project.draft && projectMatches(project, needle))
    .sort((a, b) => b.project.date.localeCompare(a.project.date)) : [];
  const invoices = needle ? (snapshot?.taxInvoices ?? []).filter((invoice) => matchesSearch(
    normalizeSearch([invoice.invoiceNumber, invoice.project.name, invoice.customer.companyNameEn, invoice.customer.companyNameKm].join(" ")), needle,
  )).slice(0, 4) : [];
  const customers = needle ? (snapshot?.clients ?? []).filter((client) => matchesSearch(normalizeSearch(client.name), needle)).slice(0, 4) : [];
  const params = new URLSearchParams({ q: needle }).toString();
  const listHref = `${BILLING}/projects?${params}`;
  const close = () => dialog.current?.close();

  return (
    <>
      <button className="bw-icon bw-search-btn" aria-label={t("search")} title={`${t("search")} ⌘K`} onClick={() => dialog.current?.showModal()} type="button">
        <SearchIcon />
      </button>
      <dialog ref={dialog} className="bw-search-dialog" aria-labelledby="billing-search-title">
        <div className="bw-heading" data-layout-group>
          <h2 id="billing-search-title">{t("search")}</h2>
          <button className="bw-control" type="button" onClick={close}>{common("common.close")}</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); close(); router.push(listHref); }}>
          <input className="bw-input" autoFocus aria-label={t("searchProjects")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchProjects")} />
        </form>
        {needle && (
          <div className="bw-search-results">
            {results.length === 0 && invoices.length === 0 && customers.length === 0 && <WorkspaceState />}
            {results.slice(0, 6).map(({ project, client }) => (
              <Link key={project.id} href={projectHref(project.id, params)} onClick={close}><strong>{project.name}</strong><small>{client}</small></Link>
            ))}
            {invoices.map((invoice) => (
              <Link key={invoice.id} href={`${BILLING}/tax-invoices/${invoice.id}`} onClick={close}><strong>{invoice.invoiceNumber}</strong><small>{t("invoices")}</small></Link>
            ))}
            {customers.map((client) => (
              <Link key={client.id} href={`${BILLING}/customers/${encodeURIComponent(client.id)}`} onClick={close}><strong>{client.name}</strong><small>{t("customers")}</small></Link>
            ))}
            {results.length > 0 && <Link className="bw-text-link" href={listHref} onClick={close}>{t("searchAll")}</Link>}
          </div>
        )}
      </dialog>
    </>
  );
}

function Header({ projects }: { projects: ProjectView[] }) {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useSession();
  const router = useRouter();
  const copy = useWorkspaceT();
  return (
    <header className="bw-header">
      <div className="bw-header-inner" data-layout-group>
        <Link className="bw-brand" href={BILLING} data-testid="v2-brand" aria-label={t("v2.brand")}><b>CIJD</b><span>Billing</span></Link>
        <Navigation />
        <div className="bw-preferences" data-layout-group>
          <GlobalSearch projects={projects} />
          <div className="bw-seg" role="group" aria-label={copy("language")}>
            {(["ja", "en", "kh"] as const).map((code) => (
              <button key={code} type="button" aria-pressed={locale === code} onClick={() => setLocale(code)}>{code.toUpperCase()}</button>
            ))}
          </div>
          <button className="bw-icon" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("theme.toggle")}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          {user && (
            <Popover.Root>
              <Popover.Trigger className="bw-icon bw-account" aria-label={user.name} data-testid="v2-account">{user.name.slice(0, 1).toUpperCase()}</Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner className="bw-popover-position" side="bottom" align="end" sideOffset={8}>
                  <Popover.Popup className="bw-popover">
                    <Popover.Title>{user.name}</Popover.Title>
                    <Popover.Description>{t(`role.${user.role}`)}</Popover.Description>
                    <button type="button" onClick={() => void signOut().then(() => router.push("/signin"))}>{t("signin.signOut")}</button>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
      </div>
    </header>
  );
}

export function BillingWorkspace({ children }: { children: ReactNode }) {
  const { snapshot, error } = useData();
  const { user, ready } = useSession();
  const path = usePathname();
  const router = useRouter();
  const allowed = !!user && canAny(user.role, ["billing:read", "billing:price:write", "payment:read"]);
  const projects = useMemo(() => snapshot ? buildProjectViews(snapshot) : [], [snapshot]);

  const pricingCandidates = useMemo(() => snapshot ? pricingCustomerCandidates(snapshot.clients, projects) : [], [snapshot, projects]);

  useEffect(() => {
    if (ready && !user) router.replace("/signin");
    if (ready && user && !allowed) router.replace(homeFor(user.role));
  }, [ready, user, allowed, router]);

  const content = ready && allowed && snapshot ? children : <WorkspaceState mode={error ? "error" : "loading"} />;
  if (path.startsWith(`${BILLING}/tax-invoices/`)) return <main className="bw-standalone min-h-dvh bg-bg">{content}</main>;
  const classic = [`${BILLING}/accounting`, `${BILLING}/customers`].includes(path);

  return (
    <ProjectContext.Provider value={projects}>
      <PricingCustomerContext.Provider value={pricingCandidates}>
        <div className="bw-shell">
          <Header projects={projects} />
          <main className={classic ? "bw-main bw-main-classic" : "bw-main"} id="billing-content">
            {error && snapshot && <WorkspaceState mode="error" />}
            {content}
          </main>
        </div>
      </PricingCustomerContext.Provider>
    </ProjectContext.Provider>
  );
}
