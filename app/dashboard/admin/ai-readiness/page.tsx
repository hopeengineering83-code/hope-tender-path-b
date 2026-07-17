import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getAIEnvironmentReadiness } from "../../../../lib/ai-environment-readiness";
import { ArrowRightIcon } from "../../../../components/icons";

const SCOPE_ORDER = ["ai", "ocr", "database", "auth", "runtime"] as const;
type Scope = (typeof SCOPE_ORDER)[number];

const SCOPE_LABELS: Record<Scope, string> = {
  ai: "AI providers and models",
  ocr: "PDF OCR",
  database: "Database",
  auth: "Authentication",
  runtime: "Runtime safeguards",
};

function Pill({ ok }: { ok: boolean }) {
  return ok
    ? <span aria-label="Environment variable is set" className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">SET</span>
    : <span aria-label="Environment variable is missing" className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">MISSING</span>;
}

export default async function AIReadinessPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const report = getAIEnvironmentReadiness();
  const groupedVariables = SCOPE_ORDER
    .map((scope) => ({
      scope,
      label: SCOPE_LABELS[scope],
      variables: report.variables.filter((variable) => variable.scope === scope),
    }))
    .filter((group) => group.variables.length > 0);

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
        <p className="mt-1 text-sm text-slate-600">
          {report.ready
            ? "Ready means no critical runtime blocker is active. Recommended or optional variables may still be missing."
            : "Blocked means at least one critical runtime requirement is not satisfied."}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-600">
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

      <div className="space-y-4 md:hidden">
        {groupedVariables.map((group) => (
          <section key={group.scope} aria-labelledby={`environment-scope-${group.scope}`} className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 id={`environment-scope-${group.scope}`} className="font-semibold text-slate-900">{group.label}</h2>
            <div className="mt-3 space-y-3">
              {group.variables.map((variable) => (
                <article key={variable.name} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <code className="min-w-0 break-all text-sm font-semibold text-slate-900">{variable.name}</code>
                    <Pill ok={variable.present} />
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="font-medium text-slate-500">Severity</dt>
                    <dd className="capitalize text-slate-700">{variable.severity}</dd>
                    <dt className="font-medium text-slate-500">Scope</dt>
                    <dd className="capitalize text-slate-700">{variable.scope}</dd>
                    <dt className="font-medium text-slate-500">Purpose</dt>
                    <dd className="break-words text-slate-700">{variable.note}</dd>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="hidden overflow-x-auto rounded-2xl border bg-white shadow-sm md:block">
        <table className="min-w-[760px] divide-y divide-slate-200 text-sm">
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
                <td className="px-4 py-3 capitalize text-slate-600">{variable.scope}</td>
                <td className="px-4 py-3 capitalize text-slate-600">{variable.severity}</td>
                <td className="px-4 py-3 text-slate-600">{variable.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
