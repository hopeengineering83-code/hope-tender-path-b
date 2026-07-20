import React from "react";
import type { AIEnvironmentVariableStatus } from "../lib/ai-environment-readiness";

const GROUPS = [
  { key: "zai", label: "Z.ai", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("ZAI_") },
  { key: "cerebras", label: "Cerebras", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("CEREBRAS_") },
  { key: "mistral", label: "Mistral", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("MISTRAL_") },
  { key: "groq", label: "Groq", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("GROQ_") },
  { key: "openrouter", label: "OpenRouter", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("OPENROUTER_") },
  { key: "gemini", label: "Gemini", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("GEMINI_") },
  { key: "openai", label: "OpenAI", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("OPENAI_") },
  { key: "together", label: "Together", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("TOGETHER_") },
  { key: "deepseek", label: "DeepSeek", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("DEEPSEEK_") },
  { key: "anthropic", label: "Anthropic", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" && variable.name.startsWith("ANTHROPIC_") },
  { key: "ai-other", label: "Other AI", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ai" },
  { key: "ocr", label: "OCR", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "ocr" },
  { key: "database", label: "Database", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "database" },
  { key: "auth", label: "Authentication", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "auth" },
  { key: "runtime", label: "Runtime", matches: (variable: AIEnvironmentVariableStatus) => variable.scope === "runtime" },
];

export function getConfigurationState(variable: AIEnvironmentVariableStatus) {
  const className = {
    SET: "bg-green-100 text-green-700",
    ENABLED: "bg-green-100 text-green-700",
    DISABLED: "bg-slate-100 text-slate-600",
    INACTIVE: "bg-slate-100 text-slate-500",
    NOT_CONFIGURED: "bg-slate-100 text-slate-600",
    DEFAULTED: "bg-blue-100 text-blue-700",
    RECOMMENDED: "bg-amber-100 text-amber-800",
    OPTIONAL: "bg-slate-100 text-slate-600",
    MISSING: "bg-red-100 text-red-700",
  }[variable.configurationState];
  return { label: variable.configurationState.replaceAll("_", " "), className };
}

export function getSeverityLabel(variable: AIEnvironmentVariableStatus) {
  return variable.requirementLabel;
}

function StatusPill({ variable }: { variable: AIEnvironmentVariableStatus }) {
  const state = getConfigurationState(variable);
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.className}`}>{state.label}</span>;
}

export function groupEnvironmentVariables(variables: AIEnvironmentVariableStatus[]) {
  const remaining = new Set(variables);
  return GROUPS.map((group) => {
    const matches = variables.filter((variable) => remaining.has(variable) && group.matches(variable));
    matches.forEach((variable) => remaining.delete(variable));
    return { key: group.key, label: group.label, variables: matches };
  }).filter((group) => group.variables.length > 0);
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
                <td className="px-4 py-3"><StatusPill variable={variable} /></td>
                <td className="px-4 py-3 text-slate-600">{variable.scope}</td>
                <td className="px-4 py-3 text-slate-600">{getSeverityLabel(variable)}</td>
                <td className="px-4 py-3 text-slate-600">{variable.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 md:hidden" aria-label="Environment variables by scope">
        {groups.map(({ key, label, variables: scopedVariables }) => (
          <details key={key} className="rounded-2xl border bg-white shadow-sm">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
              {label} variables ({scopedVariables.length})
            </summary>
            <div className="divide-y divide-slate-100 border-t">
              {scopedVariables.map((variable) => (
                <article key={variable.name} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <code className="min-w-0 break-all text-sm font-semibold text-slate-900">{variable.name}</code>
                    <StatusPill variable={variable} />
                  </div>
                  <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="font-medium text-slate-500">Scope</dt>
                    <dd className="capitalize text-slate-700">{variable.scope}</dd>
                    <dt className="font-medium text-slate-500">Severity</dt>
                    <dd className="capitalize text-slate-700">{getSeverityLabel(variable)}</dd>
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
