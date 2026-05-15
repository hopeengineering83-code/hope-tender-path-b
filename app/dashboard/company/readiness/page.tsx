import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../lib/company-ingestion-readiness";
import { prisma, prismaReady } from "../../../../lib/prisma";

function StatusPill({ ready }: { ready: boolean }) {
  return ready
    ? <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">READY</span>
    : <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">NEEDS REVIEW</span>;
}

function Metric({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value ?? "—"}</p>
    </div>
  );
}

export default async function CompanyReadinessPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);
  const report = await getCompanyIngestionReadiness(company.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Company Vault</p>
          <h1 className="text-2xl font-bold text-slate-900">Knowledge readiness</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Checks whether company documents, extracted knowledge, reviewed experts, reviewed projects, and statutory records are ready for tender generation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill ready={report.ingestionReady} />
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open Company Vault
          </Link>
        </div>
      </div>

      {report.blockers.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-semibold text-red-900">Hard blockers</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
            {report.blockers.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">Warnings</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {report.warnings.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Company documents" value={report.totals.documents} />
        <Metric label="Useful extracted documents" value={report.totals.usefulDocuments} />
        <Metric label="Reviewed experts" value={`${report.totals.reviewedExperts}/${report.totals.experts}`} />
        <Metric label="Reviewed projects" value={`${report.totals.reviewedProjects}/${report.totals.projects}`} />
        <Metric label="Pending extractions" value={report.totals.pendingDocuments} />
        <Metric label="Failed extractions" value={report.totals.failedDocuments} />
        <Metric label="Legal records" value={report.totals.legalRecords} />
        <Metric label="Financial records" value={report.totals.financialRecords} />
        <Metric label="Expected experts" value={report.totals.expectedExperts} />
        <Metric label="Missing experts" value={report.totals.missingExperts} />
        <Metric label="Expected projects" value={report.totals.expectedProjects} />
        <Metric label="Missing projects" value={report.totals.missingProjects} />
      </div>
    </div>
  );
}
