import React from "react";
import type { AIEnvironmentVariableStatus } from "../lib/ai-environment-readiness";

const SCOPE_ORDER: AIEnvironmentVariableStatus["scope"][] = [
  "ai",
  "ocr",
  "database",
  "auth",
  "runtime",
];

function StatusPill({ present }: { present: boolean }) {
  return present ? (
    <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">SET</span>
  ) : (
    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">MISSING</span>
  );
}

export function groupEnvironmentVariables(variables: AIEnvironmentVariableStatus[]) {
  return SCOPE_ORDER.map((scope) => ({
    scope,
    variables: variables.filter((variable) => variable.scope === scope),
  })).filter((group) => group.variables.length > 0);
}

export function AIEnvironmentVariableStatusList({
  variables,
}: {
  variables: AIEnvironmentVariableStatus[];
}) {
  const groups = groupEnvironmentVariables(variables);

  return (
    <>
      <section className="hidden overflow-x-auto rounded-2xl border bg-white shadow-sm md:block" aria-label="Environment variables">
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
            {variables.map((variable) => (
              <tr key={variable.name}>
                <td className="px-4 py-3 font-mono text-slate-900">{variable.name}</td>
                <td className="px-4 py-3"><StatusPill present={variable.present} /></td>
                <td className="px-4 py-3 text-slate-600">{variable.scope}</td>
                <td className="px-4 py-3 text-slate-600">{variable.severity}</td>
                <td className="px-4 py-3 text-slate-600">{variable.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 md:hidden" aria-label="Environment variables by scope">
        {groups.map(({ scope, variables: scopedVariables }) => (
          <details key={scope} className="rounded-2xl border bg-white shadow-sm" open={scope === "ai"}>
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold capitalize text-slate-900">
              {scope} variables ({scopedVariables.length})
            </summary>
            <div className="divide-y divide-slate-100 border-t">
              {scopedVariables.map((variable) => (
                <article key={variable.name} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <code className="min-w-0 break-all text-sm font-semibold text-slate-900">{variable.name}</code>
                    <StatusPill present={variable.present} />
                  </div>
                  <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="font-medium text-slate-500">Scope</dt>
                    <dd className="capitalize text-slate-700">{variable.scope}</dd>
                    <dt className="font-medium text-slate-500">Severity</dt>
                    <dd className="capitalize text-slate-700">{variable.severity}</dd>
                    <dt className="font-medium text-slate-500">Purpose</dt>
                    <dd className="break-words text-slate-700">{variable.note}</dd>
                  </dl>
                </article>
              ))}
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
