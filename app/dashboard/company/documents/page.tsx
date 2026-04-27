import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";

const CATEGORY_LABELS: Record<string, string> = {
  COMPANY_PROFILE: "Company Profile",
  LEGAL_REGISTRATION: "Legal / Registration",
  FINANCIAL_STATEMENT: "Financial Statements",
  MANUAL: "Manuals / Policies",
  EXPERT_CV: "Expert CV Source Docs",
  PROJECT_REFERENCE: "Project Reference Source Docs",
  PROJECT_CONTRACT: "Project Contracts",
  CERTIFICATION: "Certificates",
  COMPLIANCE_RECORD: "Compliance Records",
  PORTFOLIO: "Portfolio",
  OTHER: "Other Documents",
};

const CATEGORY_HELPERS: Record<string, string> = {
  COMPANY_PROFILE: "Company identity, profile summary, services, offices and flagship capabilities.",
  LEGAL_REGISTRATION: "TIN, VAT, licenses, commercial registration, competence and supplier evidence.",
  FINANCIAL_STATEMENT: "Audits, turnover, assets, profit and financial capacity evidence.",
  MANUAL: "QA, ethics, anti-corruption, technical review procedures and manuals.",
  EXPERT_CV: "Only documents in this category are allowed to create Expert records.",
  PROJECT_REFERENCE: "Only documents in this category are allowed to create Project Reference records.",
  PROJECT_CONTRACT: "Project contracts and completion evidence used as project proof.",
  CERTIFICATION: "Certificates and formal credentials.",
  COMPLIANCE_RECORD: "Compliance registers and evidence.",
  PORTFOLIO: "Portfolio documents and company brochures.",
  OTHER: "Support documents that do not create experts or projects.",
};

const CARD_STYLES: Record<string, string> = {
  COMPANY_PROFILE: "border-blue-200 bg-blue-50 text-blue-800",
  LEGAL_REGISTRATION: "border-red-200 bg-red-50 text-red-800",
  FINANCIAL_STATEMENT: "border-amber-200 bg-amber-50 text-amber-800",
  MANUAL: "border-slate-200 bg-slate-50 text-slate-800",
  EXPERT_CV: "border-purple-200 bg-purple-50 text-purple-800",
  PROJECT_REFERENCE: "border-green-200 bg-green-50 text-green-800",
  PROJECT_CONTRACT: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CERTIFICATION: "border-orange-200 bg-orange-50 text-orange-800",
  COMPLIANCE_RECORD: "border-rose-200 bg-rose-50 text-rose-800",
  PORTFOLIO: "border-teal-200 bg-teal-50 text-teal-800",
  OTHER: "border-slate-200 bg-slate-50 text-slate-700",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileExt(name: string) {
  return name.toLowerCase().split(".").pop()?.toUpperCase() || "FILE";
}

export default async function CompanyDocumentCategoriesPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);
  const documents = await prisma.companyDocument.findMany({
    where: { companyId: company.id },
    orderBy: [{ category: "asc" }, { createdAt: "desc" }],
  });

  const grouped = documents.reduce<Record<string, typeof documents>>((acc, doc) => {
    const key = doc.category || "OTHER";
    acc[key] = acc[key] || [];
    acc[key].push(doc);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Knowledge Vault</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Document Categories</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Company support documents are separated from Expert CV and Project Reference source documents. Support documents remain in Documents only and must not create experts or projects.
          </p>
        </div>
        <Link href="/dashboard/company" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Back to Knowledge Vault
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => {
          const docs = grouped[category] || [];
          return (
            <a key={category} href={`#${category}`} className={`rounded-2xl border p-5 shadow-sm transition hover:shadow-md ${CARD_STYLES[category] || CARD_STYLES.OTHER}`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold">{CATEGORY_LABELS[category] || category}</h2>
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold">{docs.length}</span>
              </div>
              <p className="mt-2 text-xs opacity-80">{CATEGORY_HELPERS[category] || "Categorized company document evidence."}</p>
            </a>
          );
        })}
      </div>

      <div className="space-y-5">
        {categories.map((category) => {
          const docs = grouped[category] || [];
          return (
            <section key={category} id={category} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{CATEGORY_LABELS[category] || category}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{CATEGORY_HELPERS[category] || "Categorized company document evidence."}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{docs.length} file{docs.length === 1 ? "" : "s"}</span>
              </div>
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="rounded-xl border px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 rounded border bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">{fileExt(doc.originalFileName)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{doc.originalFileName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{formatBytes(doc.size)}</span>
                          {doc.extractedText ? <span className="text-green-600">✓ {doc.extractedText.length.toLocaleString()} chars extracted</span> : <span>No extracted text</span>}
                          <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
