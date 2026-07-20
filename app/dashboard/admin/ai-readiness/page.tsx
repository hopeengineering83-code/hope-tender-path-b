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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Admin</p>
        <h1 className="text-2xl font-bold text-slate-900">AI environment readiness</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Checks whether Vercel environment variables required for extraction, analysis, scoring, proposal generation, OCR, database, and session security are available to the running app. Secret values are never displayed.
        </p>
      </div>

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

      {report.blockers.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-white p-5">
          <h2 className="font-semibold text-red-800">Blockers</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
            {report.blockers.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {report.warnings.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white p-5">
          <h2 className="font-semibold text-amber-800">Warnings</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {report.warnings.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      <AIEnvironmentVariableStatusList variables={report.variables} />
    </div>
  );
}
