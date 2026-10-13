import React from "react";
import type { AIEnvironmentVariableStatus } from "../lib/ai-environment-readiness";

/**
 * Grouping for the environment-variable readiness list.
 *
 * The provider rows are DERIVED from the catalog, not written out again here.
 * This file used to carry its own ten-line copy of the provider order, with a
 * comment explaining that it could not import the registry because that module
 * resolves API keys from the environment at module scope and this component
 * renders in the browser. That reasoning was sound about the REGISTRY and wrong
 * about the ORDER: lib/ai-provider-catalog.cjs is plain CJS that touches
 * process.env only inside function bodies, so it is safe to import here and is
 * the same literal the registry itself builds on.
 *
 * The consequence of the copy was a test — ai-provider-ui-order-drift — whose
 * whole job was to notice when the two lists disagreed. Deriving the order
 * removes the disagreement rather than detecting it.
 *
 * Only the human-readable LABELS are declared locally, since the catalog has no
 * opinion about display text. The Record typing makes a missing label a compile
 * error rather than a blank row.
 */
import {
  CANONICAL_AI_PROVIDER_ORDER,
  PROVIDER_API_KEY_ENV,
} from "../lib/ai-provider-catalog.cjs";

type ProviderKey = (typeof CANONICAL_AI_PROVIDER_ORDER)[number];

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  gemini: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  zai: "Z.ai",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
  openai: "OpenAI",
  together: "Together",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
};

/** "ZAI_API_KEY" → "ZAI_" — the prefix every one of that provider's vars shares. */
function envPrefixFor(provider: ProviderKey): string {
  return PROVIDER_API_KEY_ENV[provider].replace(/API_KEY$/, "");
}

export const ENVIRONMENT_VARIABLE_GROUPS = [
  ...CANONICAL_AI_PROVIDER_ORDER.map((provider) => {
    const prefix = envPrefixFor(provider);
    return {
      key: provider,
      label: PROVIDER_LABELS[provider],
      matches: (variable: AIEnvironmentVariableStatus) =>
        variable.scope === "ai" && variable.name.startsWith(prefix),
    };
  }),
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
  return ENVIRONMENT_VARIABLE_GROUPS.map((group) => {
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
