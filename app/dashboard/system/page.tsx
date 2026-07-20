import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getSystemReadiness } from "../../../lib/system-readiness";
import {
  deploymentEnvironmentLabel,
  resolveBuildSha,
  resolveDeploymentEnvironment,
} from "../../../lib/deployment-context.cjs";

function badge(severity: string) {
  if (severity === "CRITICAL") return "bg-red-100 text-red-700 border-red-200";
  if (severity === "WARNING") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-green-100 text-green-700 border-green-200";
}

export default async function SystemReadinessPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  const readiness = await getSystemReadiness();
  const environment = resolveDeploymentEnvironment(process.env);
  const environmentLabel = deploymentEnvironmentLabel(environment);
  const buildSha = resolveBuildSha(process.env);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">System Status</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Deployment context and production prerequisites</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Deployment identity and operational readiness are separate facts. A preview or production-mode build does not prove that storage, extraction, sessions, and final-package prerequisites are ready.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6" aria-labelledby="deployment-context-title">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Deployment context</p>
          <h2 id="deployment-context-title" className="mt-1 text-lg font-semibold text-blue-900">
            {environmentLabel}
          </h2>
          <p className="mt-2 text-sm text-blue-800">
            Commit: {buildSha === "unavailable" ? "unavailable — deployment identity is incomplete" : <code>{buildSha}</code>}
          </p>
          <p className="mt-2 text-xs text-blue-700">
            Only Vercel&apos;s deployment environment may label this app as production or preview. CI and local production-mode builds are identified separately.
          </p>
        </section>

        <section
          className={`rounded-2xl border p-6 ${readiness.productionReady ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
          aria-labelledby="production-prerequisites-title"
        >
          <p className={`text-xs font-semibold uppercase tracking-wide ${readiness.productionReady ? "text-green-600" : "text-red-600"}`}>
            Operational readiness
          </p>
          <h2 id="production-prerequisites-title" className={`mt-1 text-lg font-semibold ${readiness.productionReady ? "text-green-800" : "text-red-800"}`}>
            {readiness.productionReady ? "Production prerequisites satisfied" : "Production prerequisites incomplete"}
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            Critical checks must be resolved before trusting final tender generation, final document approval, or submission packaging.
          </p>
        </section>
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
