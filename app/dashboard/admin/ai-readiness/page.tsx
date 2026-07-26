import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getAIEnvironmentReadiness } from "../../../../lib/ai-environment-readiness";
import { ArrowRightIcon } from "../../../../components/icons";
import { AIEnvironmentVariableStatusList } from "../../../../components/ai-environment-variable-status";

export default async function AIReadinessPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const report = getAIEnvironmentReadiness();
  const providerVariables = report.variables.filter(
    (variable) => variable.scope === "ai" && variable.name.endsWith("_API_KEY"),
  );
  const activeProviderCount = providerVariables.filter((variable) => variable.present).length;
  const missingRequiredCount = report.variables.filter(
    (variable) => variable.configurationState === "MISSING",
  ).length;
  const actionCount = report.blockers.length + report.warnings.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Admin</p>
        <h1 className="text-2xl font-bold text-slate-900">AI environment readiness</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Checks whether deployment variables required for extraction, analysis, scoring, proposal generation, OCR, database, and session security are available to the running app. Secret values are never displayed.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="AI readiness summary">
        <SummaryCard label="Runtime" value={report.ready ? "Ready" : "Blocked"} tone={report.ready ? "good" : "bad"} />
        <SummaryCard label="Active AI providers" value={String(activeProviderCount)} tone={activeProviderCount > 0 ? "good" : "bad"} />
        <SummaryCard label="Required values missing" value={String(missingRequiredCount)} tone={missingRequiredCount === 0 ? "good" : "bad"} />
        <SummaryCard label="Actions to review" value={String(actionCount)} tone={actionCount === 0 ? "good" : "warn"} />
      </section>

      <div className={`rounded-2xl border p-5 ${report.ready ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
        <h2 className="font-semibold text-slate-900">Runtime status: {report.ready ? "ready" : "blocked"}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-600">
          <span>Provider chain:</span>
          {report.providerChain.length > 0
            ? report.providerChain.map((provider, i) => (
                <span key={provider} className="inline-flex items-center gap-1.5">
                  {i > 0 && <ArrowRightIcon className="text-slate-400" />}
                  {provider}
                </span>
              ))
            : "none"}
        </p>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5" aria-labelledby="ai-remediation-title">
        <h2 id="ai-remediation-title" className="font-semibold text-blue-950">What to do next</h2>
        {actionCount === 0 ? (
          <p className="mt-2 text-sm leading-6 text-blue-800">
            No environment remediation is required. Continue with System Status and the System Safety Center before promoting a release.
          </p>
        ) : (
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-blue-900">
            <li>Review the blocker and warning messages below and note each variable name exactly.</li>
            <li>Open the deployment project&apos;s <strong>Settings → Environment Variables</strong>. Add or change the named values for the intended Production or Preview environment. Do not paste secret values into Hope Tender.</li>
            <li>Redeploy the same environment. A running deployment cannot read newly added variables until a new deployment starts.</li>
            <li>Return to this page and confirm <strong>Runtime status: ready</strong>, then verify System Status and the System Safety Center.</li>
          </ol>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href="/dashboard/system" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2">
            Open System Status
          </Link>
          <Link href="/dashboard/admin/safety-center" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-800 no-underline hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2">
            Open System Safety Center
          </Link>
          <Link href="/dashboard/admin" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2">
            Back to Admin
          </Link>
        </div>
      </section>

      {report.blockers.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-white p-5" aria-labelledby="ai-blockers-title">
          <h2 id="ai-blockers-title" className="font-semibold text-red-800">Blockers</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
            {report.blockers.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {report.warnings.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white p-5" aria-labelledby="ai-warnings-title">
          <h2 id="ai-warnings-title" className="font-semibold text-amber-800">Warnings</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-700">
            {report.warnings.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-semibold text-slate-900">
          Environment variable details ({report.variables.length} checks)
        </summary>
        <div className="border-t border-slate-200 p-4 sm:p-5">
          <p className="mb-4 text-sm leading-6 text-slate-500">
            Detailed diagnostics are collapsed by default so blockers and remediation remain visible first. Statuses show presence and effective defaults only; secret values are never returned.
          </p>
          <AIEnvironmentVariableStatusList variables={report.variables} />
        </div>
      </details>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  const valueClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-red-700";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
