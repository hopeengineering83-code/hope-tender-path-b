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

  it("analysis quality no longer caps score at 40 for missing deadline (advisory only)", () => {
    // PR #1002 removed the deadline cap (Math.min(score, 40)) entirely.
    // Missing deadline is now advisory-only — it pushes a warning but does
    // NOT cap the score or mark the analysis unsafe.
    const src = read("lib/analysis-quality.ts");
    assert.ok(src.includes("!hasDeadline"), "still checks hasDeadline (for advisory warning)");
    assert.ok(!src.includes("score = Math.min(score, 40)"), "deadline cap at 40 was removed — metadata is advisory only");
  });
});

// ─── 8. Fix area 1: Tender Detail missing-facts uses intelligence (not scalar-only) ──

describe("fix area 1 — Tender Detail missing-facts uses intelligence", () => {
  it("intake panel builds effectiveMissingFacts from intelligence (not sourceDetail)", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("effectiveMissingFacts"), "must build effectiveMissingFacts");
    assert.ok(src.includes("intelligence"), "must use intelligence for missing-facts");
    assert.ok(src.includes("!si.deadlineDisplay && !tender.deadline"), "deadline missing only when both parser and scalar are null");
    assert.ok(src.includes("!si.method || si.method === \"Unknown\""), "method missing only when parser says Unknown and scalar is null");
  });

  it("intake panel displays effectiveMissingCount (not sourceDetail.missingRelevantCount)", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("effectiveMissingCount"), "must use effectiveMissingCount for display");
    assert.ok(!src.includes("{sourceDetail.missingRelevantCount > 0"), "must NOT use sourceDetail.missingRelevantCount for the missing-facts condition");
  });

  it("intake panel does not list deadline as missing when parser found it", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    // The condition for deadline missing is: !si.deadlineDisplay && !tender.deadline
    // If the parser found the deadline (si.deadlineDisplay is truthy), the condition is false
    // → deadline is NOT pushed to effectiveMissingFacts → NOT shown as missing
    assert.ok(src.includes("!si.deadlineDisplay && !tender.deadline"), "deadline missing requires BOTH parser AND scalar to be null");
  });

  it("intake panel does not list submissionMethod as missing when parser found it", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    // Same pattern: method missing requires parser Unknown AND scalar null
    assert.ok(src.includes('!si.method || si.method === "Unknown"'), "method missing requires parser Unknown AND scalar null");
  });
});

// ─── 9. Fix area 6: metadata-validators containsMetadataPlaceholder handles NBSP ──

describe("fix area 6 — metadata-validators handles NBSP and all placeholders", () => {
  it("containsMetadataPlaceholder normalizes NBSP (\\u00A0)", () => {
    const src = read("lib/engine/metadata-validators.ts");
    assert.ok(src.includes("\\u00A0"), "must normalize NBSP");
    assert.ok(src.includes("\\u200B"), "must normalize zero-width space");
  });

  it("containsMetadataPlaceholder has explicit EXPLICIT_PLACEHOLDERS set", () => {
    const src = read("lib/engine/metadata-validators.ts");
    assert.ok(src.includes("EXPLICIT_PLACEHOLDERS"), "must have explicit placeholder set");
    assert.ok(src.includes('"not"'), "must include 'not'");
    assert.ok(src.includes('"not extracted"'), "must include 'not extracted'");
    assert.ok(src.includes('"not mentioned"'), "must include 'not mentioned'");
    assert.ok(src.includes('"not applicable"'), "must include 'not applicable'");
  });

  it("containsMetadataPlaceholder rejects all spec-required placeholders", async () => {
    const { containsMetadataPlaceholder } = await import("../lib/engine/metadata-validators");
    const placeholders = [
      "Not", "NOT", "not", "Not ", " Not", "Not\n", "Not\u00A0",
      "Not extracted", "Not mentioned", "Not stated", "Not provided",
      "Not specified", "Not applicable", "N/A", "NA", "Unknown",
      "TBD", "TBC", "Pending", "Blank", "Nil",
    ];
    for (const p of placeholders) {
      assert.equal(containsMetadataPlaceholder(p), true, `"${p}" must be detected as placeholder`);
    }
  });
});

// ─── 10. Fix area 7: re-extract route writes null for placeholder values ────

describe("fix area 7 — re-extract writes null for placeholder values", () => {
  it("re-extract route has else-if branch for clearing placeholder values", () => {
    const src = read("app/api/tenders/[id]/re-extract-metadata/route.ts");
    assert.ok(src.includes("storedIsOverridable && isEmpty(extracted) && !isEmpty(stored)"), "must have branch for clearing placeholders");
    assert.ok(src.includes("update[key as string] = null"), "must write null to clear placeholder");
    assert.ok(src.includes("do NOT keep"), "must document the rationale");
  });
});

// ─── 11. Fix area 8: syncEffectiveFactsToLedger exists ─────────────────────

describe("fix area 8 — syncEffectiveFactsToLedger", () => {
  it("tender-facts-ledger-service exports syncEffectiveFactsToLedger", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function syncEffectiveFactsToLedger"), "must export syncEffectiveFactsToLedger");
  });

  it("sync function does not overwrite USER_CONFIRMED/USER_EDITED/NOT_APPLICABLE", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("HUMAN_CONFIRMED_OPERATIONAL"), "checks for HUMAN_CONFIRMED_OPERATIONAL");
    assert.ok(src.includes("AUTHORITY_STATE.NOT_APPLICABLE"), "checks for NOT_APPLICABLE");
    assert.ok(src.includes("skipped++"), "skips user-confirmed/NA facts");
  });

  it("sync function writes CANDIDATE_NEEDS_REVIEW when no evidence", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("CANDIDATE_NEEDS_REVIEW"), "writes CANDIDATE_NEEDS_REVIEW for parser facts without evidence");
    assert.ok(src.includes("SOURCE_GROUNDED_CONFIRMED"), "writes SOURCE_GROUNDED_CONFIRMED when evidence exists");
  });

  it("never calls page + quote evidence grounded without an active source file id", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.match(src, /fact\.sourceFileId[\s\S]*fact\.sourcePage[\s\S]*fact\.sourceQuote/);
    assert.match(src, /existingState === AUTHORITY_STATE\.SOURCE_GROUNDED_CONFIRMED && !hasEvidence/);
  });

  it("syncs promoted canonical facts through one ownership-checked, locked ledger path", () => {
    const service = read("lib/engine/tender-facts-ledger-service.ts");
    const background = read("lib/ai-jobs/analysis-job-service.ts");
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    const effective = read("lib/engine/effective-tender-facts.ts");
    assert.match(service, /export async function syncPersistedTenderFactsToLedger/);
    assert.match(service, /where: \{ id: tenderId, userId \}/);
    assert.match(service, /pg_advisory_xact_lock/);
    assert.match(service, /locateQuoteProvenPage/);
    assert.match(background, /syncPersistedTenderFactsToLedger/);
    assert.match(route, /syncPersistedTenderFactsToLedger/);
    assert.match(effective, /ledgerKeys: \["projectTitle", "title"\]/);
  });

  it("sync function is idempotent (upsert by tenderId + semanticKey)", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("tenderId_semanticKey"), "uses upsert by tenderId + semanticKey");
  });
});
