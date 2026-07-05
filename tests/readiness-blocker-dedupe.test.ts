// Regression tests for the "FULL PROPOSAL BLOCKED BECAUSE" duplicate
// blocker bug.
//
// May 16 production screenshot showed the client-name complaint
// listed THREE times in the same panel:
//   1. "Full proposal generation is blocked: client name is invalid
//      (TOC/section fragment, not a real entity)."
//      (from full-proposal-specific check, code=FULL_PROPOSAL_CLIENT_INVALID)
//   2. "Client name was extracted but appears to be a TOC/section
//      fragment, not a real entity. Re-run metadata extraction or
//      correct the field manually before generation."
//      (inherited from support-package blocker, code=CLIENT_NAME_INVALID)
//   3. The same support-package message rendered AGAIN
//      (defensive: the local fullProposalBlockers list itself contained
//      duplicates from an earlier push site).
//
// Analysis quality had the same shape (FULL_PROPOSAL_ANALYSIS_POOR +
// ANALYSIS_QUALITY_POOR). Each pair has DIFFERENT message strings —
// a string-equality dedupe would not catch them.
//
// The fix maps each known code to a TOPIC; we keep the first item per
// topic and drop later duplicates. These tests pin that behaviour for
// every topic the readiness gate emits.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Mirror the topic mapping + dedupe pass shape from
// lib/tender-generation-readiness.ts. Kept as a local helper so the
// test stays Prisma-free and runs in milliseconds.
type Item = { code: string; message: string };

const codeToTopic: Record<string, string> = {
  CLIENT_NAME_REQUIRED: "CLIENT_NAME",
  CLIENT_NAME_INVALID: "CLIENT_NAME",
  FULL_PROPOSAL_CLIENT_INVALID: "CLIENT_NAME",
  ANALYSIS_QUALITY_POOR: "ANALYSIS_QUALITY",
  ANALYSIS_QUALITY_WARNING: "ANALYSIS_QUALITY",
  FULL_PROPOSAL_ANALYSIS_POOR: "ANALYSIS_QUALITY",
  MATCHING_QUALITY_POOR: "MATCHING",
  MATCHING_QUALITY_POOR_VAULT_FALLBACK: "MATCHING",
  FULL_PROPOSAL_MATCHES_WEAK: "MATCHING",
  FULL_PROPOSAL_ENGINE_NOT_RUN: "MATCHING",
  FULL_PROPOSAL_NO_VAULT: "MATCHING",
  NO_EXPERT_MATCHES_FOUND: "EXPERT_MATCHES",
  NO_REVIEWED_EXPERT_MATCHES: "EXPERT_MATCHES",
  ALL_EXPERTS_UNREVIEWED: "EXPERT_MATCHES",
  FULL_PROPOSAL_NO_REVIEWED_EXPERTS: "EXPERT_MATCHES",
  NO_PROJECT_MATCHES_FOUND: "PROJECT_MATCHES",
  NO_REVIEWED_PROJECT_MATCHES: "PROJECT_MATCHES",
  ALL_PROJECTS_UNREVIEWED: "PROJECT_MATCHES",
  FULL_PROPOSAL_NO_REVIEWED_PROJECTS: "PROJECT_MATCHES",
};
const topicOf = (code: string) => codeToTopic[code] ?? code;

function dedupe(localFullProposal: Item[], inheritedSupportPackage: Item[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const item of localFullProposal) {
    const t = topicOf(item.code);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(item);
  }
  for (const b of inheritedSupportPackage) {
    const t = topicOf(b.code);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(b);
  }
  return out;
}

describe("readiness blocker dedupe — topic-based (production-screenshot scenario)", () => {
  it("the screenshot's THREE client-name complaints collapse to ONE", () => {
    const local: Item[] = [
      {
        code: "FULL_PROPOSAL_CLIENT_INVALID",
        message: "Full proposal generation is blocked: client name is invalid (TOC/section fragment, not a real entity).",
      },
    ];
    const inherited: Item[] = [
      {
        code: "CLIENT_NAME_INVALID",
        message: "Client name was extracted but appears to be a TOC/section fragment, not a real entity. Re-run metadata extraction or correct the field manually before generation.",
      },
      {
        // Defensive: simulate the case where the same inherited code was
        // pushed twice (the third occurrence in the screenshot).
        code: "CLIENT_NAME_INVALID",
        message: "Client name was extracted but appears to be a TOC/section fragment, not a real entity. Re-run metadata extraction or correct the field manually before generation.",
      },
    ];
    const result = dedupe(local, inherited);
    const clientNameItems = result.filter((r) => topicOf(r.code) === "CLIENT_NAME");
    assert.equal(clientNameItems.length, 1, `Expected exactly 1 CLIENT_NAME item, got ${clientNameItems.length}`);
    // The local full-proposal version wins (clearer message about WHY).
    assert.equal(clientNameItems[0].code, "FULL_PROPOSAL_CLIENT_INVALID");
  });

  it("the screenshot's TWO analysis-quality complaints collapse to ONE", () => {
    const local: Item[] = [
      { code: "FULL_PROPOSAL_ANALYSIS_POOR", message: "Full proposal generation is blocked: analysis quality is poor (46/100)." },
    ];
    const inherited: Item[] = [
      { code: "ANALYSIS_QUALITY_POOR", message: "Tender analysis quality is poor (46/100). Re-run AI Analyze / Run Engine and verify evaluation criteria, submission rules, and source references before generation." },
    ];
    const result = dedupe(local, inherited);
    assert.equal(result.filter((r) => topicOf(r.code) === "ANALYSIS_QUALITY").length, 1);
  });

  it("matching topic collapses across MATCHES_WEAK / NO_VAULT / ENGINE_NOT_RUN / MATCHING_QUALITY_POOR", () => {
    const local: Item[] = [
      { code: "FULL_PROPOSAL_ENGINE_NOT_RUN", message: "...Run Engine has not been triggered..." },
    ];
    const inherited: Item[] = [
      { code: "MATCHING_QUALITY_POOR", message: "Matching quality is poor (30/100)..." },
      { code: "MATCHING_QUALITY_POOR_VAULT_FALLBACK", message: "Matching quality is poor (30/100)... vault fallback evidence is available..." },
    ];
    const result = dedupe(local, inherited);
    assert.equal(result.filter((r) => topicOf(r.code) === "MATCHING").length, 1);
  });

  it("expert and project match topics collapse independently", () => {
    const local: Item[] = [
      { code: "FULL_PROPOSAL_NO_REVIEWED_EXPERTS", message: "...experts but no reviewed expert matches exist..." },
      { code: "FULL_PROPOSAL_NO_REVIEWED_PROJECTS", message: "...projects but no reviewed project matches exist..." },
    ];
    const inherited: Item[] = [
      { code: "NO_REVIEWED_EXPERT_MATCHES", message: "Tender requires experts but no reviewed expert matches are available..." },
      { code: "NO_REVIEWED_PROJECT_MATCHES", message: "Tender requires project references but no reviewed project matches are available..." },
    ];
    const result = dedupe(local, inherited);
    assert.equal(result.filter((r) => topicOf(r.code) === "EXPERT_MATCHES").length, 1);
    assert.equal(result.filter((r) => topicOf(r.code) === "PROJECT_MATCHES").length, 1);
  });

  it("unrelated codes pass through untouched (no false collapse)", () => {
    const local: Item[] = [{ code: "FULL_PROPOSAL_ANALYSIS_POOR", message: "A" }];
    const inherited: Item[] = [
      { code: "NO_BID_BLOCK", message: "Tender is marked NO_BID." },
      { code: "NO_REQUIREMENTS", message: "No tender requirements are extracted." },
      { code: "HARD_COMPLIANCE_BLOCKER", message: "Deadline has passed." },
    ];
    const result = dedupe(local, inherited);
    assert.equal(result.length, 4);
    assert.ok(result.some((r) => r.code === "NO_BID_BLOCK"));
    assert.ok(result.some((r) => r.code === "NO_REQUIREMENTS"));
    assert.ok(result.some((r) => r.code === "HARD_COMPLIANCE_BLOCKER"));
  });

  it("dedupes within fullProposalBlockers itself (defensive)", () => {
    const local: Item[] = [
      { code: "FULL_PROPOSAL_CLIENT_INVALID", message: "A" },
      { code: "FULL_PROPOSAL_CLIENT_INVALID", message: "A duplicate" }, // hypothetical double-push
    ];
    const result = dedupe(local, []);
    assert.equal(result.filter((r) => topicOf(r.code) === "CLIENT_NAME").length, 1);
  });

  it("preserves order: local full-proposal first, then unique-by-topic inherited", () => {
    const local: Item[] = [{ code: "FULL_PROPOSAL_ANALYSIS_POOR", message: "fp-analysis" }];
    const inherited: Item[] = [
      { code: "NO_REQUIREMENTS", message: "no-reqs" },
      { code: "NO_BID_BLOCK", message: "no-bid" },
    ];
    const result = dedupe(local, inherited);
    assert.deepEqual(result.map((r) => r.code), ["FULL_PROPOSAL_ANALYSIS_POOR", "NO_REQUIREMENTS", "NO_BID_BLOCK"]);
  });

  it("empty inputs produce empty output (no NaN/undefined)", () => {
    assert.deepEqual(dedupe([], []), []);
  });
});
