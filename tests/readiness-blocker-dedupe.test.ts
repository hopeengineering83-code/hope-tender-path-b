// Regression test for the "FULL PROPOSAL BLOCKED BECAUSE" duplicated
// blocker bug (May 16 production screenshot).
//
// Before the fix: the same "Client name was extracted but appears to be
// a TOC/section fragment..." message appeared TWICE in the panel
// because:
//   1. The local full-proposal check pushed FULL_PROPOSAL_CLIENT_INVALID
//   2. The "inherit support-package blockers" loop pushed CLIENT_NAME_INVALID
// Different codes, same message text → two visually identical bullets.
//
// The dedupe now skips inherited blockers whose message text was already
// pushed by the full-proposal-specific check.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Pure helper — mirrors the dedupe shape from
// lib/tender-generation-readiness.ts so we can test the rule without
// spinning up a Prisma client.
type Item = { code: string; message: string };
function dedupeFullProposalBlockers(localFullProposal: Item[], inheritedSupportPackage: Item[]): Item[] {
  const out = [...localFullProposal];
  const seen = new Set(out.map((item) => item.message));
  for (const b of inheritedSupportPackage) {
    if (seen.has(b.message)) continue;
    seen.add(b.message);
    out.push(b);
  }
  return out;
}

describe("readiness blocker dedupe", () => {
  it("does NOT list the same message twice when codes differ but text matches", () => {
    const localFP: Item[] = [
      { code: "FULL_PROPOSAL_CLIENT_INVALID", message: "Client name was extracted but appears to be a TOC/section fragment, not a real entity." },
      { code: "FULL_PROPOSAL_ANALYSIS_POOR", message: "Analysis quality is poor (46/100)." },
    ];
    const inherited: Item[] = [
      { code: "CLIENT_NAME_INVALID", message: "Client name was extracted but appears to be a TOC/section fragment, not a real entity." },
      { code: "NO_REQUIREMENTS", message: "No tender requirements are extracted." },
    ];
    const result = dedupeFullProposalBlockers(localFP, inherited);
    const clientMessages = result.filter((r) => r.message.startsWith("Client name was extracted"));
    assert.equal(clientMessages.length, 1, "Client-invalid message should appear exactly once after dedupe");
    // Inherited blockers with NEW messages still come through.
    assert.ok(result.some((r) => r.code === "NO_REQUIREMENTS"));
    assert.equal(result.length, 3);
  });

  it("preserves order: local full-proposal first, then unique inherited", () => {
    const localFP: Item[] = [{ code: "LOCAL_A", message: "a" }];
    const inherited: Item[] = [{ code: "INHERIT_B", message: "b" }, { code: "INHERIT_C", message: "c" }];
    const result = dedupeFullProposalBlockers(localFP, inherited);
    assert.deepEqual(result.map((r) => r.code), ["LOCAL_A", "INHERIT_B", "INHERIT_C"]);
  });

  it("empty inputs produce empty output (no NaN/undefined)", () => {
    assert.deepEqual(dedupeFullProposalBlockers([], []), []);
  });
});
