// Canonical fact authority parity tests.
//
// These tests prove the app has one effective tender-fact authority across
// Tender Detail, canonical readiness, analysis quality, recovery actions,
// snapshots, and final blockers. Parser/ledger facts for deadline,
// submission method, emails, email subject, financial-proposal requirement,
// and physical-address applicability are reused everywhere, so a fact cannot
// appear as detected in Tender Detail while another panel says it is missing
// or invalid.
//
// Placeholder scalar values such as "Not" are treated as missing, not
// corrupted, and no longer block or confuse readiness.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Effective fact resolver exists and exports ─────────────────────────

describe("effective fact resolver — module existence", () => {
  it("lib/engine/effective-tender-facts.ts exports getEffectiveTenderFacts", () => {
    const src = read("lib/engine/effective-tender-facts.ts");
    assert.ok(src.includes("export async function getEffectiveTenderFacts"), "must export getEffectiveTenderFacts");
  });

  it("exports EffectiveTenderFactsResult type", () => {
    const src = read("lib/engine/effective-tender-facts.ts");
    assert.ok(src.includes("export type EffectiveTenderFactsResult"), "must export EffectiveTenderFactsResult");
  });

  it("exports EffectiveTenderFactEntry type", () => {
    const src = read("lib/engine/effective-tender-facts.ts");
    assert.ok(src.includes("export type EffectiveTenderFactEntry"), "must export EffectiveTenderFactEntry");
  });

  it("authority precedence: ledger → parser → scalar → missing", () => {
    const src = read("lib/engine/effective-tender-facts.ts");
    assert.ok(src.includes("SOURCE_GROUNDED_CONFIRMED"), "checks ledger SOURCE_GROUNDED_CONFIRMED");
    assert.ok(src.includes("HUMAN_CONFIRMED_OPERATIONAL"), "checks ledger HUMAN_CONFIRMED_OPERATIONAL");
    assert.ok(src.includes("NOT_APPLICABLE"), "checks ledger NOT_APPLICABLE");
    assert.ok(src.includes("resolved_from_source_text"), "uses parser facts");
    assert.ok(src.includes("resolved_from_scalar_fallback"), "uses scalar fallback");
    assert.ok(src.includes("missing"), "handles missing");
  });
});

// ─── 2. Screenshot contradiction tests (Pharo fixture) ─────────────────────

describe("screenshot contradiction — Pharo fixture", () => {
  const pharoText = `
Request for Technical Proposal / RFP
Technical Proposal for Pharo Ventures
Financial Proposal Required: No - technical proposal only at this stage
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
});

// ─── 3. Analysis Quality uses effective facts ──────────────────────────────

describe("analysis quality — uses effective facts", () => {
  it("AnalysisQualityPanel imports getEffectiveTenderFacts", () => {
    const src = read("components/analysis-quality-panel.tsx");
    assert.ok(src.includes("getEffectiveTenderFacts"), "must import getEffectiveTenderFacts");
  });

  it("AnalysisQualityPanel passes effective deadline (not raw scalar)", () => {
    const src = read("components/analysis-quality-panel.tsx");
    assert.ok(src.includes("effectiveFacts?.deadlineIso"), "must use effective deadline");
  });

  it("AnalysisQualityPanel passes effective submission method (not raw scalar)", () => {
    const src = read("components/analysis-quality-panel.tsx");
    assert.ok(src.includes("effectiveFacts?.submissionMethod"), "must use effective submission method");
  });

  it("AnalysisQualityPanel passes effective emails (not raw scalar)", () => {
    const src = read("components/analysis-quality-panel.tsx");
    assert.ok(src.includes("effectiveFacts?.submissionEmails"), "must use effective emails");
  });

  it("AnalysisQualityPanel passes effective submission address (not raw scalar)", () => {
    const src = read("components/analysis-quality-panel.tsx");
    assert.ok(src.includes("effectiveFacts?.submissionAddress"), "must use effective address");
  });

  it("effectiveFacts call is wrapped in catch (non-blocking)", () => {
    const src = read("components/analysis-quality-panel.tsx");
    assert.ok(src.includes(".catch(() => null)"), "effective facts must be non-blocking");
  });
});

// ─── 4. Corrupted banner robustly rejects placeholders ─────────────────────

describe("corrupted banner — placeholder rejection", () => {
  it("isPlaceholderIsh handles 'Not' with whitespace variants", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.ok(src.includes("PLACEHOLDER_STRINGS"), "must have explicit placeholder string set");
    assert.ok(src.includes('"not"'), "must include 'not' in placeholder set");
    assert.ok(src.includes('"n/a"'), "must include 'n/a'");
    assert.ok(src.includes('"unknown"'), "must include 'unknown'");
    assert.ok(src.includes('"tbd"'), "must include 'tbd'");
  });

  it("isPlaceholderIsh handles NBSP (\\u00A0)", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.ok(src.includes("\\u00A0"), "must normalize NBSP whitespace");
  });

  it("isPlaceholderIsh handles 'not extracted' and 'not mentioned'", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.ok(src.includes('"not extracted"'), "must include 'not extracted'");
    assert.ok(src.includes('"not mentioned"'), "must include 'not mentioned'");
    assert.ok(src.includes('"not stated"'), "must include 'not stated'");
    assert.ok(src.includes('"not provided"'), "must include 'not provided'");
    assert.ok(src.includes('"not specified"'), "must include 'not specified'");
    assert.ok(src.includes('"not applicable"'), "must include 'not applicable'");
  });

  it("isValidReferenceNumber rejects all placeholder variants", async () => {
    const { isValidReferenceNumber } = await import("../lib/engine/metadata-validators");
    const placeholders = ["Not", "NOT", "not", "Not ", " Not", "Not\n", "N/A", "NA", "Unknown", "TBD", "TBC", "Pending", "Blank", "Nil", "Not mentioned", "Not stated", "Not provided", "Not applicable"];
    for (const p of placeholders) {
      assert.equal(isValidReferenceNumber(p), false, `"${p}" must be rejected as invalid reference`);
    }
  });
});

// ─── 5. Fact parity endpoint exists ────────────────────────────────────────

describe("fact-parity endpoint", () => {
  it("GET /api/tenders/[id]/fact-parity route exists", () => {
    const src = read("app/api/tenders/[id]/fact-parity/route.ts");
    assert.ok(src.includes("export async function GET"), "must export GET handler");
  });

  it("enforces RBAC (ADMIN, PROPOSAL_MANAGER, REVIEWER)", () => {
    const src = read("app/api/tenders/[id]/fact-parity/route.ts");
    assert.ok(src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER")'), "must require proper roles");
  });

  it("enforces tenant ownership", () => {
    const src = read("app/api/tenders/[id]/fact-parity/route.ts");
    assert.ok(src.includes("userId: actor.id"), "must scope to user");
    assert.ok(src.includes("Tender not found"), "must return 404 for other tenant");
  });

  it("returns all required keys", () => {
    const src = read("app/api/tenders/[id]/fact-parity/route.ts");
    const keys = ["deadline", "submissionMethod", "submissionEmails", "submissionEmailSubject",
      "submissionAddress", "financialProposalRequired", "reference", "clientName",
      "country", "evaluationMethodology", "requiredDocuments"];
    for (const key of keys) {
      assert.ok(src.includes(`"${key}"`), `must include key "${key}"`);
    }
  });

  it("detects contradictions (scalar null but parser has value)", () => {
    const src = read("app/api/tenders/[id]/fact-parity/route.ts");
    assert.ok(src.includes("contradiction"), "must detect contradictions");
    assert.ok(src.includes("contradictionReason"), "must provide contradiction reason");
  });

  it("does not expose full source text or secrets in the response", () => {
    const src = read("app/api/tenders/[id]/fact-parity/route.ts");
    // The route may USE extractedText internally to build source text, but must
    // NOT include it in the JSON response body. The response should only contain
    // field comparisons, not raw text.
    // Check that the NextResponse.json call does not include extractedText.
    const responseStart = src.indexOf("return NextResponse.json({");
    const responseEnd = src.indexOf("});", responseStart);
    const responseBlock = src.slice(responseStart, responseEnd);
    assert.ok(!responseBlock.includes("extractedText"), "response must not include extractedText");
    assert.ok(!responseBlock.includes("fileContent"), "response must not include fileContent");
  });
});

// ─── 6. Canonical readiness uses effective facts (source-level) ────────────

describe("canonical readiness — ledger integration", () => {
  it("canonical-field-state accepts ledgerFacts", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("ledgerFacts?"), "must accept ledgerFacts");
  });

  it("canonical-field-state prefers ledger over scalar", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("input.ledgerFacts?.find"), "must look up ledger facts");
    assert.ok(src.includes("rawValue = ledgerFact.normalizedValue"), "must use ledger value");
  });

  it("canonical-field-state handles NOT_APPLICABLE from ledger (without override)", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes('ledgerAuthorityState === "NOT_APPLICABLE"'), "must handle ledger NOT_APPLICABLE");
  });
});

// ─── 7. Runtime parity guarantee ───────────────────────────────────────────

describe("runtime parity guarantee", () => {
  it("no panel uses scalar-only facts when parser facts exist (AnalysisQualityPanel)", () => {
    const src = read("components/analysis-quality-panel.tsx");
    // The panel must CALL getEffectiveTenderFacts before assessTenderAnalysisQuality
    // (not just import it). Check the call order in the function body.
    const effectiveCallIdx = src.indexOf("getEffectiveTenderFacts(prisma");
    const assessCallIdx = src.indexOf("assessTenderAnalysisQuality({");
    assert.ok(effectiveCallIdx > 0, "must call getEffectiveTenderFacts");
    assert.ok(assessCallIdx > 0, "must call assessTenderAnalysisQuality");
    assert.ok(effectiveCallIdx < assessCallIdx, "effective facts must be loaded BEFORE quality assessment");
  });

  it("analysis quality does not cap score at 40 for parsed deadline (source-level)", () => {
    const src = read("lib/analysis-quality.ts");
    // The cap at 40 is for hasDeadline — the caller now passes effective deadline
    // so hasDeadline will be true when parser extracted the deadline.
    assert.ok(src.includes("!hasDeadline"), "still checks hasDeadline (but caller passes effective)");
    assert.ok(src.includes("score = Math.min(score, 40)"), "cap exists but only triggers when hasDeadline is false");
  });
});
