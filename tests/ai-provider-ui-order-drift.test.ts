// The canonical provider order is marked NEVER-change, and the project guide
// requires "docs, gates, health routes, and UI" to match it. Most consumers
// derive from lib/ai-provider-catalog.cjs, so they cannot drift.
//
// components/ai-environment-variable-status.tsx cannot derive from it: the
// provider registry resolves API keys from the environment at module scope and
// that component renders in the browser, so importing it there would pull
// key-reading code into the client bundle. It therefore writes the order down a
// second time, and nothing held the two together — the existing UI-truth test
// checks that each provider's variables are *reported*, never that the rendered
// grouping is complete or correctly ordered. A reordering or a dropped provider
// would have shipped silently.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ENVIRONMENT_VARIABLE_GROUPS } from "../components/ai-environment-variable-status";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-registry";

describe("AI provider UI grouping tracks the canonical order", () => {
  // The non-provider buckets that legitimately follow the provider list.
  const NON_PROVIDER_KEYS = ["ai-other", "ocr", "database", "auth", "runtime"];

  it("lists exactly the canonical providers, in canonical order, first", () => {
    const providerKeys = ENVIRONMENT_VARIABLE_GROUPS
      .map((group) => group.key)
      .filter((key) => !NON_PROVIDER_KEYS.includes(key));

    assert.deepEqual(
      providerKeys,
      [...CANONICAL_AI_PROVIDER_ORDER],
      "the rendered provider grouping must match CANONICAL_AI_PROVIDER_ORDER exactly — same providers, same order",
    );
  });

  it("keeps Anthropic last, as the emergency-only provider", () => {
    const providerKeys = ENVIRONMENT_VARIABLE_GROUPS
      .map((group) => group.key)
      .filter((key) => !NON_PROVIDER_KEYS.includes(key));
    assert.equal(providerKeys.at(-1), "anthropic");
  });

  it("still renders the non-provider buckets after the providers", () => {
    const keys = ENVIRONMENT_VARIABLE_GROUPS.map((group) => group.key);
    for (const key of NON_PROVIDER_KEYS) {
      assert.ok(keys.includes(key), `${key} grouping must still be rendered`);
    }
    const lastProviderIndex = keys.indexOf(CANONICAL_AI_PROVIDER_ORDER.at(-1)!);
    for (const key of NON_PROVIDER_KEYS) {
      assert.ok(
        keys.indexOf(key) > lastProviderIndex,
        `${key} must come after the provider list, not interleaved with it`,
      );
    }
  });

  it("gives every group a distinct key", () => {
    const keys = ENVIRONMENT_VARIABLE_GROUPS.map((group) => group.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate group keys would render a provider twice");
  });
});
