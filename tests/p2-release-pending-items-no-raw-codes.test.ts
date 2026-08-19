// The release panel's "Pending items" list showed internal identifiers.
//
// Observed on the deployed Preview, verbatim:
//
//   • Full proposal generation is blocked: Run Engine has not been triggered …
//   • FULL_PROPOSAL_ENGINE_NOT_RUN
//   • ENGINE_NOT_COMPLETED
//   • NO_TENDER_SPECIFIC_EXPERT_MATCHES
//   • NO_SELECTED_REVIEWED_EXPERTS
//   • NO_ACTIVE_GENERATED_DOCUMENTS
//   • NO_CURRENT_CONFIRMED_BUILD_PLAN
//
// Two defects in one list. Every entry after the first is a raw UPPER_SNAKE
// code — the repository already ships an audit for user-facing metadata and a
// `humanizeEnumValue` helper whose own comment describes this exact failure.
// And the first two entries are the SAME blocker: a sentence, then its own
// internal identifier restated directly beneath it.
//
// The panel collected human messages from the message-bearing sources and raw
// codes from the code-bearing ones into one flat list, with no shared key, so
// neither problem could be noticed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

/** Exactly the codes seen in the screenshot. */
const OBSERVED_CODES = [
  "FULL_PROPOSAL_ENGINE_NOT_RUN",
  "ENGINE_NOT_COMPLETED",
  "NO_TENDER_SPECIFIC_EXPERT_MATCHES",
  "NO_SELECTED_REVIEWED_EXPERTS",
  "NO_ACTIVE_GENERATED_DOCUMENTS",
  "NO_CURRENT_CONFIRMED_BUILD_PLAN",
] as const;

const RAW_CODE_SHAPE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

describe("release pending items never show internal identifiers", () => {
  it("gives every observed blocker code a human label", async () => {
    const { releaseBlockerLabel } = await import("../lib/ui/human-labels");

    for (const code of OBSERVED_CODES) {
      const label = releaseBlockerLabel(code);
      assert.notEqual(label, code, `${code} must not render as its own identifier`);
      assert.ok(
        !RAW_CODE_SHAPE.test(label),
        `${code} rendered as raw-code-shaped text: ${label}`,
      );
      assert.ok(label.length > 0);
    }
  });

  it("humanises an unmapped code instead of shouting it", async () => {
    const { releaseBlockerLabel } = await import("../lib/ui/human-labels");

    // The readiness layer keeps adding codes. A new one must still read like a
    // gap, not like a log line — this is why releaseBlockerLabel exists rather
    // than reusing errorCodeLabel, which deliberately falls back to the code.
    const label = releaseBlockerLabel("SOME_FUTURE_BLOCKER_CODE");
    assert.ok(!RAW_CODE_SHAPE.test(label), `unmapped code leaked: ${label}`);
    assert.equal(label, "Some future blocker code");
  });

  it("errorCodeLabel keeps its raw fallback — the two helpers are not interchangeable", async () => {
    const { errorCodeLabel } = await import("../lib/ui/human-labels");

    // Guards against someone "simplifying" the two into one and silently
    // changing behaviour for the many existing errorCodeLabel callers.
    assert.equal(errorCodeLabel("SOME_FUTURE_BLOCKER_CODE"), "SOME_FUTURE_BLOCKER_CODE");
  });

  it("lists a blocker once, preferring the sentence over its identifier", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/generation-action-panel.tsx", "utf8");

    // Keyed by code so a message and its own code cannot both be listed.
    assert.match(source, /blockersByCode\s*=\s*new Map/, "blockers must be keyed by code");
    assert.match(source, /releaseBlockerLabel\(code\)/, "codes must be humanised before display");

    // The exact shape of the old bug: pushing a bare code into the display list.
    assert.ok(
      !/visibleBlockers\.push\(code\)/.test(source),
      "no raw blocker code may be pushed into the display list",
    );

    // Message sources must be read before code sources, or a generic label
    // would win over a specific sentence for the same blocker.
    const messageIdx = source.indexOf("readiness?.blockers ?? []) addMessage");
    const codeIdx = source.indexOf("releaseDecision?.blockerCodes ?? []) addCode");
    assert.ok(messageIdx > 0 && codeIdx > 0, "both collection paths must exist");
    assert.ok(messageIdx < codeIdx, "message sources must be collected before code sources");
  });

  it("still drops NO_REQUIREMENTS from the visible list", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/generation-action-panel.tsx", "utf8");

    // Pre-existing behaviour that must survive the refactor.
    assert.match(source, /NO_REQUIREMENTS/, "the NO_REQUIREMENTS exclusion must be preserved");
  });
});
