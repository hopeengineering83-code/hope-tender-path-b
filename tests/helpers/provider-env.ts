/**
 * An exact provider configuration for a test, independent of the machine.
 *
 * Provider tests describe a specific chain — "groq and openai are configured"
 * — and then assert what the router does with it. Two ways of building that
 * environment let the ambient machine change the answer:
 *
 *   const env = { ...process.env, GROQ_API_KEY: "k", OPENAI_API_KEY: "k" };
 *
 * silently adds every OTHER provider the developer or CI happens to have
 * configured, and a per-file `beforeEach` that deletes a hand-written list of
 * variables misses the ones nobody thought of — the `_BASE_URL` and
 * `_FAST_MODEL` suffixes in particular.
 *
 * Both were live: with `CEREBRAS_API_KEY` set, `configuredProviders` became
 * `["groq", "cerebras", "openai"]` and an assertion of
 * `configuredProviders.slice(0, 2)` against `["groq", "openai"]` failed —
 * even though that IS the canonical order, cerebras being rank 5, between
 * groq at 2 and openai at 7. With `CEREBRAS_BASE_URL` pointed at a local
 * gateway, an assertion that the contacted URL contains "cerebras" failed
 * even though the provider was contacted at the right position.
 *
 * Neither was a routing defect. Both were tests reading their own machine.
 *
 * So: build the provider environment from nothing, name every provider the
 * case depends on, and let anything the case does not name be genuinely
 * absent. A test then means the same thing on a laptop with ten real keys as
 * it does on a clean CI runner, which is the only way it can be evidence
 * about the canonical order rather than about the operator's .env.
 */

import { CANONICAL_AI_PROVIDER_ORDER, ALL_PROVIDER_API_KEY_ENVS } from "../../lib/ai-provider-catalog.cjs";

/**
 * Every environment variable suffix that changes how a provider behaves.
 *
 * Keys decide whether a provider is configured at all; models and base URLs
 * decide which endpoint and profile it resolves to; the TPM limit decides
 * whether it is skipped. A leftover value in any of them can move a provider
 * in or out of a chain, so a test that means to describe an exact
 * configuration has to clear all of them.
 */
const PROVIDER_ENV_SUFFIXES = [
  "_API_KEY",
  "_BASE_URL",
  "_MODEL",
  "_ANALYSIS_MODEL",
  "_PROPOSAL_MODEL",
  "_FAST_MODEL",
  "_TPM_LIMIT",
] as const;

/** Every provider-scoped variable name, for every provider in the chain. */
export function providerEnvVarNames(): string[] {
  const names = new Set<string>(ALL_PROVIDER_API_KEY_ENVS as string[]);
  for (const provider of CANONICAL_AI_PROVIDER_ORDER as string[]) {
    const prefix = provider.toUpperCase();
    for (const suffix of PROVIDER_ENV_SUFFIXES) names.add(`${prefix}${suffix}`);
  }
  // ZAI is spelled Z.ai in the chain but ZAI in the environment; the
  // uppercase of the catalog name already matches, and this keeps the set
  // correct if a provider name ever gains punctuation.
  return [...names].filter((name) => /^[A-Z0-9_]+$/.test(name));
}

/**
 * `process.env` with every provider-scoped variable removed, then the given
 * overrides applied.
 *
 * Non-provider variables (NODE_ENV, DATABASE_URL, CI…) are preserved, because
 * a provider test still needs the rest of its runtime to work.
 */
export function providerEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of providerEnvVarNames()) delete env[name];
  return { ...env, ...overrides };
}

/**
 * Clear every provider-scoped variable from the real `process.env` and return
 * a restore function.
 *
 * For tests that exercise code reading `process.env` directly rather than
 * taking an env argument. Call the returned function in `afterEach` so a
 * developer's configuration survives the run.
 */
export function isolateProviderEnv(overrides: Record<string, string> = {}): () => void {
  const saved = new Map<string, string | undefined>();
  for (const name of providerEnvVarNames()) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env[name] = value;
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
