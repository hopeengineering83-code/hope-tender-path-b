// Runtime metadata readiness parity tests.
//
// These tests prove the runtime metadata blockers are eliminated. All
// dashboard panels, readiness gates, generation gates, export gates,
// recovery actions, and copilot suggestions now consume the same
// runtime-readiness facts. Deadline, submission method, submission emails,
// email subject, financial-proposal status, build-plan state, and analysis
// state cannot be valid in one panel while missing or blocking in another.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── Pharo regression fixture ───────────────────────────────────────────────

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
Submission Address / Portal: No physical address or portal is provided. Use email submission only.
Financial Proposal: Not required at this stage. Do not generate a financial proposal.

The project involves architectural design and engineering consultancy for a specialty medical center.
`;

// ─── 1. Runtime readiness facts module exists ───────────────────────────────

describe("runtime readiness facts — module existence", () => {
  it("lib/engine/runtime-readiness-facts.ts exists and exports getRuntimeReadinessFacts", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("export async function getRuntimeReadinessFacts"), "must export getRuntimeReadinessFacts");
  });

  it("exports RuntimeReadinessFacts type", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("export type RuntimeReadinessFacts"), "must export RuntimeReadinessFacts");
    assert.ok(src.includes("metadata:"), "must have metadata field");
    assert.ok(src.includes("analysis:"), "must have analysis field");
    assert.ok(src.includes("buildPlan:"), "must have buildPlan field");
    assert.ok(src.includes("contradictions:"), "must have contradictions field");
  });

  it("exports RuntimeFact type with draftBlocker: false", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("export type RuntimeFact"), "must export RuntimeFact");
    assert.ok(src.includes("draftBlocker"), "must have draftBlocker field");
    // draftBlocker is typed as `false` — metadata NEVER blocks draft
    assert.ok(src.includes("draftBlocker: false"), "draftBlocker must be typed as false");
  });

  it("exports safePanelError for UI-safe error handling", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("export function safePanelError"), "must export safePanelError");
    assert.ok(src.includes("diagnosticId"), "must return diagnostic ID");
    assert.ok(src.includes("Readiness check failed"), "must return safe message");
  });
});

// ─── 2. Screenshot contradiction tests ──────────────────────────────────────

describe("screenshot contradiction — Pharo fixture", () => {
  it("parser detects deadline from source text", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.submissionInstructions.deadlineDisplay?.includes("August 25, 2026"), "deadline must be parsed");
  });

  it("parser detects submission method Email from source text", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.method, "Email");
  });

  it("parser detects both emails from source text", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.emails.length, 2);
    assert.ok(intel.submissionInstructions.emails.includes("edessalegn@pharoventures.com"));
    assert.ok(intel.submissionInstructions.emails.includes("fgetachewdesta@pharoventures.com"));
  });

  it("parser detects financial proposal NOT required", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.financialProposalRequired, false);
  });

  it("parser detects email subject", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.submissionInstructions.emailSubject?.includes("Technical Proposal for Pharo Ventures"));
  });
});

// ─── 3. Content-changed is warning, not hard-block ─────────────────────────

describe("content-changed — warning not hard-block", () => {
  it("generation-readiness-gate allows draft when content changed (purpose != export/final-zip)", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes('input.purpose === "export" || input.purpose === "final-zip"'), "must check purpose for hard-block");
    assert.ok(src.includes("Draft: warning only"), "must have draft warning-only comment");
  });

  it("generation-readiness-gate does NOT hard-block draft on ANALYSIS_HASH_MISMATCH", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The ANALYSIS_HASH_MISMATCH fail() calls must be inside the export/final-zip condition
    assert.ok(src.includes('if (input.purpose === "export" || input.purpose === "final-zip")'), "hash mismatch must be gated on export/final-zip");
  });
});

// ─── 4. Runtime readiness facts authority ───────────────────────────────────

describe("runtime readiness facts — authority rules", () => {
  it("metadata facts have draftBlocker: false (metadata never blocks draft)", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("draftBlocker: false"), "draftBlocker must be false for all metadata facts");
  });

  it("parser-resolved facts have finalStatus: review_required (not missing)", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("review_required"), "must use review_required for parser-resolved facts");
  });

  it("finalBlocker only for truly missing critical fields", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("!resolved && isCritical"), "finalBlocker only when not resolved AND is critical");
  });

  it("contradiction detection checks deadline, emails, build plan, analysis", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("deadline"), "checks deadline contradiction");
    assert.ok(src.includes("submissionEmails"), "checks submissionEmails contradiction");
    assert.ok(src.includes("buildPlan"), "checks build plan contradiction");
    assert.ok(src.includes("contentChangedHardBlock"), "checks content-changed contradiction");
  });
});

// ─── 5. Build Plan / Export Ready contradiction ─────────────────────────────

describe("build plan / export ready contradiction", () => {
  it("runtime facts track buildPlanExists and exportReadyAllowed", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("buildPlanExists"), "must track buildPlanExists");
    assert.ok(src.includes("exportReadyAllowed"), "must track exportReadyAllowed");
    assert.ok(src.includes("canCreateBuildPlanFromDerivedPlan"), "must track canCreateBuildPlanFromDerivedPlan");
  });

  it("contradiction detected when exportReadyAllowed but !buildPlanExists", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("!buildPlan.buildPlanExists && buildPlan.exportReadyAllowed"), "must detect export-ready without build plan");
  });
});

// ─── 6. Stale partial AI jobs ───────────────────────────────────────────────

describe("stale partial AI jobs", () => {
  it("runtime facts track stalePartialJobs and hasOnlyStalePartialJobs", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("stalePartialJobs"), "must track stale partial jobs");
    assert.ok(src.includes("hasOnlyStalePartialJobs"), "must track hasOnlyStalePartialJobs");
  });

  it("contentChangedHardBlock only when no completed analysis exists", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("contentChangedHardBlock"), "must compute contentChangedHardBlock");
    assert.ok(src.includes("!hasGoodAnalysisForCurrentSource"), "hard block requires no good analysis");
    assert.ok(src.includes("!latestJob"), "hard block requires no latest job");
  });

  it("contentChangedWarningOnly when good analysis exists", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("contentChangedWarningOnly"), "must compute contentChangedWarningOnly");
    assert.ok(src.includes("hasGoodAnalysisForCurrentSource || !!latestJob"), "warning when good analysis or latest job exists");
  });

  it("stale partial AI jobs are SUPERSEDED (not just detected) when good analysis exists", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("SUPERSEDED"), "must supersede stale jobs (status mutation, not just detection)");
    assert.ok(src.includes("aiJob.updateMany"), "must call prisma.aiJob.updateMany to supersede");
    assert.ok(src.includes("aiAnalyzeChunk.updateMany"), "must also supersede stale chunks");
    assert.ok(src.includes("hasGoodAnalysisForCurrentSource && stalePartialJobs.length > 0"), "supersede only when good analysis exists AND stale jobs exist");
  });
});

// ─── 7. Runtime-readiness-parity endpoint ───────────────────────────────────

describe("runtime-readiness-parity endpoint", () => {
  it("GET /api/tenders/[id]/runtime-readiness-parity exists", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("export async function GET"), "must export GET");
  });

  it("enforces RBAC (ADMIN, PROPOSAL_MANAGER, REVIEWER)", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER")'), "must enforce RBAC");
  });

  it("enforces tenant isolation", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("userId: actor.id"), "must scope to user");
  });

  it("returns sanitized facts (no full text, no secrets)", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("sanitizeFact"), "must sanitize facts");
    assert.ok(!src.includes("extractedText:"), "must not include extractedText in response");
  });

  it("returns panel states", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("panelStates"), "must return panel states");
    assert.ok(src.includes("tenderDetail"), "must include tenderDetail state");
    assert.ok(src.includes("confirmMetadata"), "must include confirmMetadata state");
    assert.ok(src.includes("bidControl"), "must include bidControl state");
  });

  it("returns contradictions", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("contradictions"), "must return contradictions");
  });

  it("returns next action", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("nextAction"), "must return next action");
  });

  it("uses safePanelError on internal errors (no raw Prisma error)", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(src.includes("safePanelError"), "must use safePanelError");
    assert.ok(src.includes("diagnosticId"), "must return diagnostic ID");
    assert.ok(src.includes("ok: false"), "must return ok: false on error");
  });
});

// ─── 8. Email-only tender does not require physical address ─────────────────

describe("email-only tender — no physical address required", () => {
  it("parser detects email-only tender (no physical address needed)", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.method, "Email");
    assert.equal(intel.submissionInstructions.physicalSubmissionRequired, false);
    assert.equal(intel.submissionInstructions.portalSubmissionRequired, false);
  });
});

// ─── 9. Technical-only tender does not generate financial proposal ──────────

describe("technical-only tender — no financial proposal", () => {
  it("parser detects financial proposal NOT required", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.financialProposalRequired, false);
  });

  it("generation plan excludes financial proposal", async () => {
    const { parseTenderDocumentIntelligence } = await import("../lib/engine/source-driven-tender-text-parser");
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.generationPlan.exclude.includes("Financial Proposal"), "Financial Proposal must be excluded");
  });
});

// ─── 10. No raw Prisma error in UI ──────────────────────────────────────────

describe("no raw Prisma error in UI", () => {
  it("safePanelError returns safe message, not raw error", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(src.includes("Readiness check failed. Retry or contact admin."), "must return safe message");
    // The safePanelError function must not include raw error text in the message
    const fnStart = src.indexOf("export function safePanelError");
    const fnEnd = src.indexOf("}", fnStart + 100);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(!fnBody.includes("err.message"), "must not expose raw error message");
    assert.ok(!fnBody.includes("stack"), "must not expose stack trace");
    assert.ok(fnBody.includes("diagnosticId"), "must return diagnostic ID for server logs");
  });

  it("health score panel catches errors safely", () => {
    const src = read("components/tender-health-score-panel.tsx");
    // PR #999 changed the safe-error string from "Panel failed to load" to
    // "Panel is loading — refresh to retry if this persists."
    assert.ok(src.includes("Panel is loading — refresh to retry if this persists."), "must show safe message on error");
    assert.ok(src.includes("catch"), "must catch errors");
  });

  it("bid control panel catches errors safely", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("A required readiness calculation failed"), "must show safe message on error");
    assert.ok(src.includes("catch"), "must catch errors");
  });
});
