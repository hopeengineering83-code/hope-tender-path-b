import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getSystemReadiness } from "../../../lib/system-readiness";

function badge(severity: string) {
  if (severity === "CRITICAL") return "bg-red-100 text-red-700 border-red-200";
  if (severity === "WARNING") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-green-100 text-green-700 border-green-200";
}

export default async function SystemReadinessPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  const readiness = getSystemReadiness();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">System Readiness</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Production gap analysis</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          This checks whether the deployed app satisfies the original production requirements for persistence, extraction, sessions, and file storage.
        </p>
      </div>

      <div className={`rounded-2xl border p-6 ${readiness.productionReady ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
        <p className={`text-lg font-semibold ${readiness.productionReady ? "text-green-800" : "text-red-800"}`}>
          {readiness.productionReady ? "Production ready" : "Not production ready yet"}
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Critical checks must be resolved before trusting final tender generation and submission packaging.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {readiness.checks.map((check) => (
          <div key={check.key} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">{check.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{check.detail}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${badge(check.severity)}`}>
                {check.severity}
              </span>
            </div>
            {check.requiredForProduction && <p className="mt-4 text-xs font-medium text-slate-400">Required for production</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
