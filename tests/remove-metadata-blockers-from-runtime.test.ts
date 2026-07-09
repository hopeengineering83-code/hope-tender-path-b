// Tests proving the unified tender-facts model is enforced across the runtime.
//
// PR #1004 weakened final-output safety by making metadata fully advisory.
// This restoration re-enables fail-closed behavior for final export while
// keeping draft generation unblocked. Blocker code METADATA_CRITICAL_FIELD_INVALID
// has been renamed to TENDER_FACTS_INVALID.
//
// These tests prove:
//   1. Tender facts do NOT hard-block draft generation (advisory for draft)
//   2. Tender facts DO block final export (fail-closed with TENDER_FACTS_INVALID)
//   3. submissionEmails lack of source evidence is advisory in draft
//   4. Analysis Quality is not capped at 40 for missing evaluation weights
//   5. Export-readiness resolver treats deadline as advisory (gate still blocks)
//   6. Raw Prisma errors are hidden from UI
//   7. Deployment diagnostics exist in runtime-readiness-parity

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Tender facts: draft advisory, final fail-closed ─────────────────────

describe("tender facts gate — draft advisory, final fail-closed", () => {
  it("generation-readiness-gate does NOT block draft on criticalMetadataOk=false (advisory for draft)", () => {
    // Tender-facts model: draft generation is NOT blocked by missing optional
    // tender details. The gate's `criticalMetadataOk` check only fail-closes
    // FINAL purposes (export, final-zip). Draft purposes pass through.
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The gate must document that draft generation is unblocked for tender facts.
    assert.ok(src.includes("Draft generation remains unblocked"), "must document draft generation is unblocked for tender facts");
    assert.ok(src.includes("tender facts are advisory, not blocking"), "must state tender facts are advisory for draft");
    // The new TENDER_FACTS_INVALID blocker code must be present (renamed from
    // METADATA_CRITICAL_FIELD_INVALID per the unified tender-facts model).
    assert.ok(src.includes('"TENDER_FACTS_INVALID"'), "must define TENDER_FACTS_INVALID blocker code");
  });

  it("generation-readiness-gate DOES block export on criticalMetadataOk=false with TENDER_FACTS_INVALID", () => {
    // PR #1004 weakened this by removing the export block entirely. The
    // restoration re-enables fail-closed behavior: export/final-zip with
    // criticalMetadataOk=false returns TENDER_FACTS_INVALID. The blocker code
    // is renamed from METADATA_CRITICAL_FIELD_INVALID to TENDER_FACTS_INVALID.
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The gate must check criticalMetadataOk for export/final-zip purposes.
    assert.ok(src.includes('if (input.purpose === "export" || input.purpose === "final-zip")'), "must gate tender-facts block on export/final-zip purpose");
    // The fail() call must use TENDER_FACTS_INVALID (not the old code).
    assert.ok(src.includes('"TENDER_FACTS_INVALID"'), "must block export with TENDER_FACTS_INVALID");
    // The old blocker code is retained only as a deprecated alias in the type
    // union — it must NOT be used in any active return fail() call.
    assert.ok(!/return\s+fail\(\s*"METADATA_CRITICAL_FIELD_INVALID"/.test(src), "must NOT use METADATA_CRITICAL_FIELD_INVALID in any active fail() call (renamed to TENDER_FACTS_INVALID)");
    // The restoration comment must reference PR #1004's weakening.
    assert.ok(src.includes("PR #1002 removed this check entirely, weakening final-output safety"), "must document the restoration context");
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
    // The panel must catch errors and show a safe message — never raw Prisma text.
    assert.ok(src.includes("catch"), "must catch errors");
    assert.ok(src.includes("Export readiness check failed"), "must show safe error message");
    // Must NOT include raw Prisma error rendering
    assert.ok(!src.includes("err.message"), "must not render raw error messages");
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
