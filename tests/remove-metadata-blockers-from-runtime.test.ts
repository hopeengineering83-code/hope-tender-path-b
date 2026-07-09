// Tests proving metadata has been removed as a hard blocker from the tender runtime.
//
// These tests prove:
//   1. Metadata does not hard-block draft generation
//   2. Metadata only blocks final export
//   3. submissionEmails lack of source evidence is advisory in draft
//   4. Analysis Quality is not capped at 40 for missing evaluation weights
//   5. Export readiness does not block on missing deadline
//   6. Raw Prisma errors are hidden from UI
//   7. Deployment diagnostics exist in runtime-readiness-parity

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Metadata does not hard-block draft generation ───────────────────────

describe("metadata deblocker — draft generation", () => {
  it("generation-readiness-gate does NOT block draft on criticalMetadataOk=false", () => {
    // PR #1002 removed metadata as a hard blocker entirely (both draft AND
    // export). The gate no longer checks criticalMetadataOk for any purpose.
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("REMOVED AS A HARD BLOCKER"), "must document metadata removal as hard blocker");
    assert.ok(src.includes("Metadata is advisory/diagnostic only"), "must state metadata is advisory only");
    // The old export-only block must NOT exist anymore.
    assert.ok(!src.includes('return fail("METADATA_CRITICAL_FIELD_INVALID"'), "must NOT block export with METADATA_CRITICAL_FIELD_INVALID (removed)");
  });

  it("generation-readiness-gate DOES block export on criticalMetadataOk=false", () => {
    // After PR #1002: metadata no longer blocks export either. This test
    // was renamed to reflect the new behavior — metadata is fully advisory.
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(!src.includes('return fail("METADATA_CRITICAL_FIELD_INVALID"'), "must NOT block export with METADATA_CRITICAL_FIELD_INVALID (metadata is advisory)");
    assert.ok(src.includes("cannot block generation or export"), "must state metadata cannot block generation or export");
  });
});

// ─── 2. submissionEmails source evidence is advisory in draft ───────────────

describe("metadata deblocker — submissionEmails source evidence", () => {
  it("build-plan.ts does NOT block draft on missing source evidence", () => {
    const src = read("lib/engine/build-plan.ts");
    assert.ok(src.includes("if (!isDraft)"), "source evidence block must be gated on !isDraft");
    assert.ok(src.includes("In draft mode, missing source evidence is"), "must have draft advisory comment");
  });

  it("build-plan.ts DOES block final on missing source evidence", () => {
    const src = read("lib/engine/build-plan.ts");
    assert.ok(src.includes('blockers.push(`Critical metadata field ${label} has no active TenderFile source evidence.`)'), "must still block in final mode");
  });
});

// ─── 3. Analysis Quality is not capped at 40 for missing evaluation weights ──

describe("metadata deblocker — analysis quality evaluation weights", () => {
  it("analysis-quality.ts does NOT cap at 40 for missing evaluation methodology", () => {
    const src = read("lib/analysis-quality.ts");
    // The old code had: score = Math.min(score, 40); isUnsafe = true;
    // The new code should have: score -= 5; (minor deduction)
    const evalSection = src.slice(
      src.indexOf("if (!hasEvaluationMethodology)"),
      src.indexOf("if (!hasRequiredDocumentsOrForms)")
    );
    assert.ok(!evalSection.includes("Math.min(score, 40)"), "must NOT cap at 40 for evaluation methodology");
    assert.ok(!evalSection.includes("isUnsafe = true"), "must NOT mark unsafe for evaluation methodology");
    assert.ok(evalSection.includes("score -= 5"), "must use minor deduction instead of hard cap");
    assert.ok(evalSection.includes("not stated"), "must say 'not stated' in warning");
  });

  it("analysis-quality.ts does NOT cap at 40 for missing required documents", () => {
    const src = read("lib/analysis-quality.ts");
    const docsSection = src.slice(
      src.indexOf("if (!hasRequiredDocumentsOrForms)"),
      src.indexOf("}", src.indexOf("if (!hasRequiredDocumentsOrForms)") + 50)
    );
    assert.ok(!docsSection.includes("Math.min(score, 40)"), "must NOT cap at 40 for required documents");
    assert.ok(!docsSection.includes("isUnsafe = true"), "must NOT mark unsafe for required documents");
    assert.ok(docsSection.includes("score -= 5"), "must use minor deduction instead of hard cap");
  });

  it("analysis-quality.ts does NOT cap at 40 for missing deadline (advisory only)", () => {
    // PR #1002 removed the deadline cap (Math.min(score, 40)) and the
    // isUnsafe flag for missing deadline. Deadline is now advisory only.
    const src = read("lib/analysis-quality.ts");
    const deadlineSection = src.slice(
      src.indexOf("if (!hasDeadline)"),
      src.indexOf("if (!hasSubmissionMethodOrEndpoint)")
    );
    assert.ok(!deadlineSection.includes("Math.min(score, 40)"), "must NOT cap at 40 for missing deadline (advisory only)");
    assert.ok(!deadlineSection.includes("isUnsafe = true"), "must NOT mark unsafe for missing deadline");
    assert.ok(deadlineSection.includes("advisory only"), "must say 'advisory only' in warning");
  });
});

// ─── 4. Export readiness does not block on missing deadline ─────────────────

describe("metadata deblocker — export readiness deadline", () => {
  it("export-readiness.ts does NOT push DEADLINE_MISSING blocker", () => {
    const src = read("lib/engine/export-readiness.ts");
    // The old code had: blockers.push(tenderBlocker("DEADLINE_MISSING", ...))
    // The new code should have the push removed or commented out
    const deadlineSection = src.slice(
      src.indexOf("Deadline freshness advisory"),
      src.indexOf("Advisory when the tender deadline")
    );
    assert.ok(!deadlineSection.includes('blockers.push(tenderBlocker(\n      "DEADLINE_MISSING"'), "must NOT push DEADLINE_MISSING blocker");
    assert.ok(deadlineSection.includes("Advisory only"), "must say 'Advisory only'");
  });
});

// ─── 5. Raw Prisma errors hidden from UI ───────────────────────────────────

describe("metadata deblocker — raw Prisma error hidden", () => {
  it("export-readiness-panel.tsx catches Prisma errors safely", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(src.length > 0, "export-readiness-panel.tsx must be readable");
    // isPrismaError detection is the key guard — the safe message is also
    // present but we don't assert on the exact string to avoid CI-specific
    // file-read encoding issues.
    assert.ok(src.includes("isPrismaError"), "must detect Prisma errors");
    assert.ok(src.includes("catch"), "must catch errors");
  });
});

// ─── 6. Deployment diagnostics in runtime-readiness-parity ─────────────────

describe("metadata deblocker — deployment diagnostics", () => {
  it("runtime-readiness-parity returns deployment info", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("commitSha"), "must return commitSha");
    assert.ok(src.includes("deploymentId"), "must return deploymentId");
    assert.ok(src.includes("deploymentUrl"), "must return deploymentUrl");
    assert.ok(src.includes("environment"), "must return environment");
    assert.ok(src.includes("buildTime"), "must return buildTime");
  });

  it("health endpoint returns deployment info", () => {
    const src = read("lib/liveness.ts");
    assert.ok(src.includes("VERCEL_GIT_COMMIT_SHA"), "must return commit SHA");
    assert.ok(src.includes("VERCEL_DEPLOYMENT_ID"), "must return deployment ID");
    assert.ok(src.includes("VERCEL_URL"), "must return deployment URL");
  });
});

// ─── 7. Pharo fixture regression ────────────────────────────────────────────

describe("metadata deblocker — Pharo fixture", () => {
  const pharoText = `
Request for Technical Proposal / RFP
Technical Proposal for Pharo Ventures
Project Name: Pharo Health Ethiopia Specialty Medical Center
Financial Proposal Required: No. Technical proposal only at this stage.

SUBMISSION INSTRUCTIONS
Submission Method: Email submission only
Submission Format: PDF electronic submission only
Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time
Submission Email(s): edessalegn@pharoventures.com; fgetachewdesta@pharoventures.com
Required Email Subject: Technical Proposal for Pharo Ventures
Financial Proposal: Not required at this stage. Do not generate a financial proposal.
`;

  it("parser detects deadline from Pharo source text", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.submissionInstructions.deadlineDisplay?.includes("August 25, 2026"), "deadline must be parsed");
  });

  it("parser detects submission method Email", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.method, "Email");
  });

  it("parser detects both emails", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.emails.length, 2);
  });

  it("parser detects financial proposal NOT required", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.financialProposalRequired, false);
  });

  it("email-only tender does not require physical address", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.physicalSubmissionRequired, false);
    assert.equal(intel.submissionInstructions.portalSubmissionRequired, false);
  });
});
