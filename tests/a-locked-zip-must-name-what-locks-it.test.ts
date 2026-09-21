// ─── The Export Hub must name the blocker, not its category ─────────────────
//
// THE DEFECT, from the owner's Export Hub on the Preview at commit 804a0598:
//
//   Architectural Consultancy Services ...          [Not ready]
//   1 / 1 docs generated
//   ZIP locked — 1 blocker
//   Canonical export blockers
//     Next action: Fix authority/quality blockers
//     AUTHORITY_OR_QUALITY_BLOCKERS
//   Submission checklist
//     ✅ Document workspace initialized
//     ✅ 1 document generated
//     ✅ All documents validated
//     ✅ No critical compliance gaps (0 remaining)
//     ✅ 0 warning gaps (non-blocking)
//     ✅ 2 mandatory requirements covered
//     ❌ Canonical readiness: 1 blocker(s)
//   Document checklist
//     ✅ 1. Technical Proposal.pdf
//
// Every itemised line is green. The single document passes. The only red line
// restates, as a count, the fact that a blocker exists. The owner is told to
// "fix authority/quality blockers" and given nothing to fix.
//
// THE CAUSE. The names were never missing — snapshot.exportBlockers holds
// them. The caller reduced them to a boolean by comparing list LENGTHS:
//
//   snapshot.exportBlockers.length > snapshot.generationBlockers.length
//
// so the decision layer received a bare `true` and could only paraphrase its
// own code back at the reader.
//
// TWO RULES PINNED HERE.
//   1. A locked ZIP names what locks it.
//   2. The set of authority/quality blockers is the set DIFFERENCE between
//      export and generation blockers, not the difference of their sizes —
//      counting gives the wrong answer as soon as the two lists diverge, which
//      is a correctness bug independent of the reporting one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/engine/canonical-workflow-decision.ts", "utf8");

describe("a locked ZIP must name what locks it", () => {
  it("no longer reports the category as though it were the reason", () => {
    // The bare paraphrase must not be the only thing a blocked owner is given.
    assert.equal(
      /blockerDetails\.push\("Authority review or document quality blockers remain\."\);/.test(SRC),
      false,
      "the blocker detail still restates its own category",
    );
  });

  it("renders the blocker names when the snapshot supplies them", () => {
    assert.match(SRC, /Authority or document quality blockers remain: \$\{named\.join\("; "\)\}/);
  });

  it("still fails closed when no names are available, and says so", () => {
    // Fail-closed is preserved: a nameless blocker still blocks. What changes
    // is that the message admits the detail is missing rather than implying
    // there is none.
    assert.match(SRC, /no blocker detail was supplied by the readiness snapshot/);
    assert.match(SRC, /blockerCodes\.push\("AUTHORITY_OR_QUALITY_BLOCKERS"\);/);
  });
});

describe("authority/quality blockers are identified, not counted", () => {
  it("no longer compares list lengths", () => {
    assert.equal(
      /exportBlockers\.length > snapshot\.generationBlockers\.length/.test(SRC),
      false,
      "the boolean is still derived by arithmetic on list sizes",
    );
  });

  it("uses the set difference between export and generation blockers", () => {
    assert.match(SRC, /const generationBlockerSet = new Set\(snapshot\.generationBlockers\);/);
    assert.match(SRC, /snapshot\.exportBlockers\.filter\(\(blocker\) => !generationBlockerSet\.has\(blocker\)\)/);
    // The boolean is now downstream of the identified set, not beside it.
    assert.match(SRC, /const authorityOrQualityBlockers = authorityOrQualityBlockerNames\.length > 0;/);
  });

  it("keeps the generation-blockers-first precedence", () => {
    // When generation itself is blocked, authority/quality is not yet the
    // owner's problem — that ordering must survive the change.
    assert.match(SRC, /snapshot\.exportBlockers\.length > 0 && !snapshot\.generationEligible/);
  });

  it("passes the names to the decision layer", () => {
    assert.match(SRC, /authorityOrQualityBlockerNames\?: string\[\];/);
    assert.match(SRC, /^\s{4}authorityOrQualityBlockerNames,$/m);
  });
});

describe("the change carries no tender-, sector- or benchmark-specific logic", () => {
  it("names no sector or client in the blocker derivation", () => {
    const start = SRC.indexOf("const generationBlockerSet");
    const end = SRC.indexOf("const finalExportAllowed", start);
    assert.ok(start > -1 && end > start);
    const code = SRC.slice(start, end)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const forbidden of [/\bPharo\b/i, /\bhospital/i, /\bhealthcare/i, /\bEthiopia/i, /\bmedical\b/i]) {
      assert.equal(forbidden.test(code), false, `the derivation mentions ${forbidden}`);
    }
  });
});
