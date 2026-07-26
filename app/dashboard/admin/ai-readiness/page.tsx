import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getAIEnvironmentReadiness } from "../../../../lib/ai-environment-readiness";
import { ArrowRightIcon } from "../../../../components/icons";
import { getCapabilityReadiness } from "../../../../lib/engine/capability-readiness";

function Pill({ ok }: { ok: boolean }) {
  return ok
    ? <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">SET</span>
    : <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">MISSING</span>;
}

export default async function AIReadinessPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const report = getAIEnvironmentReadiness();
  const capabilities = getCapabilityReadiness();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Admin</p>
        <h1 className="text-2xl font-bold text-slate-900">AI environment readiness</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Checks whether Vercel environment variables required for extraction, analysis, scoring, proposal generation, OCR, database, and session security are available to the running app. Secret values are never displayed.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Capability readiness</h2>
        <p className="mt-1 text-sm text-slate-500">Each runtime capability is evaluated independently. General AI readiness does not imply OCR, storage, database, or worker readiness.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((item) => (
            <article key={item.capability} className="min-w-0 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="break-words font-mono text-sm font-semibold text-slate-900">{item.capability}</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === "READY" ? "bg-green-100 text-green-700" : item.status === "DEGRADED" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{item.status}</span>
              </div>
              {item.correctiveAction && <p className="mt-2 text-xs text-slate-600">{item.correctiveAction}</p>}
            </article>
          ))}
        </div>
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
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-700">
            {report.warnings.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Variable</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Purpose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.variables.map((variable) => (
              <tr key={variable.name}>
                <td className="px-4 py-3 font-mono text-slate-900">{variable.name}</td>
                <td className="px-4 py-3"><Pill ok={variable.present} /></td>
                <td className="px-4 py-3 text-slate-600">{variable.scope}</td>
                <td className="px-4 py-3 text-slate-600">{variable.severity}</td>
                <td className="px-4 py-3 text-slate-600">{variable.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
