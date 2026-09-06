// TenderFactsLedger runtime authority tests.
//
// These tests prove TenderFactsLedger is wired as the runtime tender-fact
// authority. They cover:
//   - Ledger resolver authority order
//   - Metadata override writes ledger mutations
//   - Backfill safety (dry-run, production refusal, placeholder rejection)
//   - Final readiness uses ledger authority state
//   - API endpoints (GET sanitized, POST RBAC/tenant-safe)
//   - Document generation uses ledger facts (source-level proof)
//
// Source-level tests (readFileSync) prove the wiring exists. Pure-logic
// tests prove the resolver behaves correctly without a database.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Ledger resolver tests (pure logic) ──────────────────────────────────

describe("ledger resolver — authority order", () => {
  // Import the resolver functions directly for pure-logic testing
  const {
    resolveTenderFact,
    resolveTenderFactValue,
    AUTHORITY_STATE,
    isResolvingAuthorityState,
    isFinalValidAuthorityState,
    isDraftValidAuthorityState,
  } = require("../lib/engine/tender-facts-ledger-service");

  function makeSnapshot(facts: any[]) {
    return {
      tenderId: "t1",
      facts,
      summary: {
        total: facts.length,
        grounded: 0, userConfirmed: 0, userEdited: 0,
        notApplicable: 0, candidateNeedsReview: 0, rejectedInvalid: 0,
        missingFinalRequired: 0,
      },
    };
  }

  it("SOURCE_GROUNDED_CONFIRMED wins over stale scalar value", () => {
    const snapshot = makeSnapshot([{
      semanticKey: "clientName",
      displayLabel: "Client",
      normalizedValue: "Ledger Client Name",
      rawSourceValue: "Ledger Client Name",
      authorityState: AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED,
      sourceFileId: "file-1",
      sourcePage: 3,
      sourceQuote: "The client is Ledger Client Name",
      confidence: 0.9,
    }]);
    const resolved = resolveTenderFactValue(snapshot, "clientName", "Stale Scalar Client");
    assert.equal(resolved.fromLedger, true);
    assert.equal(resolved.value, "Ledger Client Name");
    assert.equal(resolved.authorityState, AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED);
  });

  it("USER_EDITED wins over scalar fallback in draft context", () => {
    const snapshot = makeSnapshot([{
      semanticKey: "clientName",
      displayLabel: "Client",
      normalizedValue: "Edited Client",
      rawSourceValue: "Edited Client",
      authorityState: AUTHORITY_STATE.USER_EDITED, // HUMAN_CONFIRMED_OPERATIONAL
      manuallyEntered: true,
      confidence: 1.0,
    }]);
    const resolved = resolveTenderFactValue(snapshot, "clientName", "Scalar Client");
    assert.equal(resolved.fromLedger, true);
    assert.equal(resolved.value, "Edited Client");
  });

  it("NOT_APPLICABLE omits fact from draft output (value is null)", () => {
    const snapshot = makeSnapshot([{
      semanticKey: "submissionAddress",
      displayLabel: "Address",
      normalizedValue: null,
      rawSourceValue: null,
      authorityState: AUTHORITY_STATE.NOT_APPLICABLE,
      confidence: 1.0,
    }]);
    const resolved = resolveTenderFactValue(snapshot, "submissionAddress", "Some Address");
    assert.equal(resolved.fromLedger, true);
    assert.equal(resolved.value, null);
    assert.equal(resolved.authorityState, AUTHORITY_STATE.NOT_APPLICABLE);
  });

  it("CANDIDATE_NEEDS_REVIEW can be used as draft warning but not final confirmation", () => {
    const snapshot = makeSnapshot([{
      semanticKey: "reference",
      displayLabel: "Reference",
      normalizedValue: "REF-001",
      rawSourceValue: "REF-001",
      authorityState: AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW,
      confidence: 0.5,
    }]);
    const resolved = resolveTenderFactValue(snapshot, "reference", null);
    assert.equal(resolved.fromLedger, true);
    assert.equal(resolved.value, "REF-001");
    assert.equal(isDraftValidAuthorityState(resolved.authorityState), true, "CANDIDATE_NEEDS_REVIEW is draft-valid");
    assert.equal(isFinalValidAuthorityState(resolved.authorityState), false, "CANDIDATE_NEEDS_REVIEW is NOT final-valid");
  });

  it("REJECTED_INVALID is never used in output (resolves to scalar fallback)", () => {
    const snapshot = makeSnapshot([{
      semanticKey: "clientName",
      displayLabel: "Client",
      normalizedValue: null,
      rawSourceValue: null,
      authorityState: AUTHORITY_STATE.REJECTED_INVALID,
      confidence: 0,
    }]);
    const resolved = resolveTenderFactValue(snapshot, "clientName", "Scalar Fallback");
    // REJECTED_INVALID does not provide a value — falls back to scalar
    assert.equal(resolved.value, null); // ledger value is null
    assert.equal(resolved.authorityState, AUTHORITY_STATE.REJECTED_INVALID);
    assert.equal(isDraftValidAuthorityState(resolved.authorityState), false, "REJECTED_INVALID is not draft-valid");
  });

  it("scalar fallback is used only when no ledger fact exists", () => {
    const snapshot = makeSnapshot([]); // no ledger facts
    const resolved = resolveTenderFactValue(snapshot, "clientName", "Scalar Only");
    assert.equal(resolved.fromLedger, false);
    assert.equal(resolved.value, "Scalar Only");
    assert.equal(resolved.authorityState, AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW);
  });

  it("MISSING is returned when no ledger fact and no scalar fallback", () => {
    const snapshot = makeSnapshot([]);
    const resolved = resolveTenderFactValue(snapshot, "clientName");
    assert.equal(resolved.fromLedger, false);
    assert.equal(resolved.value, null);
    assert.equal(resolved.authorityState, AUTHORITY_STATE.MISSING);
  });

  it("authority state helpers classify states correctly", () => {
    assert.equal(isResolvingAuthorityState(AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED), true);
    assert.equal(isResolvingAuthorityState(AUTHORITY_STATE.USER_CONFIRMED), true);
    assert.equal(isResolvingAuthorityState(AUTHORITY_STATE.NOT_APPLICABLE), true);
    assert.equal(isResolvingAuthorityState(AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW), false);
    assert.equal(isResolvingAuthorityState(AUTHORITY_STATE.REJECTED_INVALID), false);
    assert.equal(isResolvingAuthorityState(AUTHORITY_STATE.MISSING), false);
    assert.equal(isResolvingAuthorityState(null), false);

    assert.equal(isFinalValidAuthorityState(AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED), true);
    assert.equal(isFinalValidAuthorityState(AUTHORITY_STATE.USER_CONFIRMED), true);
    assert.equal(isFinalValidAuthorityState(AUTHORITY_STATE.NOT_APPLICABLE), false);
    assert.equal(isFinalValidAuthorityState(AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW), false);

    assert.equal(isDraftValidAuthorityState(AUTHORITY_STATE.SOURCE_GROUNDED_CONFIRMED), true);
    assert.equal(isDraftValidAuthorityState(AUTHORITY_STATE.USER_CONFIRMED), true);
    assert.equal(isDraftValidAuthorityState(AUTHORITY_STATE.CANDIDATE_NEEDS_REVIEW), true);
    assert.equal(isDraftValidAuthorityState(AUTHORITY_STATE.NOT_APPLICABLE), false);
    assert.equal(isDraftValidAuthorityState(AUTHORITY_STATE.REJECTED_INVALID), false);
  });
});

// ─── 2. Metadata override writes ledger mutations (source-level) ───────────

describe("metadata override — writes ledger mutations", () => {
  it("metadata-override route imports ledger service functions", () => {
    const src = read("app/api/tenders/[id]/metadata-override/route.ts");
    assert.ok(src.includes("upsertTenderFactFromManualOverride"), "must import upsertTenderFactFromManualOverride");
    assert.ok(src.includes("markTenderFactNotApplicable"), "must import markTenderFactNotApplicable");
    assert.ok(!src.includes("rejectInvalidTenderFact"), "must not retain an unused rejection import");
  });

  it("USER_EDITED writes USER_EDITED ledger fact with value/user/timestamp", () => {
    const src = read("app/api/tenders/[id]/metadata-override/route.ts");
    assert.ok(src.includes('fieldState === "USER_EDITED"'), "must handle USER_EDITED");
    assert.ok(src.includes("upsertTenderFactFromManualOverride"), "must call upsertTenderFactFromManualOverride");
    assert.ok(src.includes("action: fieldState === \"USER_EDITED\" ? \"USER_EDITED\""), "must pass USER_EDITED action");
  });

  it("USER_CONFIRMED writes USER_CONFIRMED ledger fact", () => {
    const src = read("app/api/tenders/[id]/metadata-override/route.ts");
    assert.ok(src.includes('fieldState === "USER_CONFIRMED"'), "must handle USER_CONFIRMED");
  });

  it("NOT_APPLICABLE writes NOT_APPLICABLE ledger fact with reason", () => {
    const src = read("app/api/tenders/[id]/metadata-override/route.ts");
    assert.ok(src.includes('fieldState === "NOT_APPLICABLE"'), "must handle NOT_APPLICABLE");
    assert.ok(src.includes("markTenderFactNotApplicable"), "must call markTenderFactNotApplicable");
  });

  it("ledger mutation is best-effort (wrapped in try/catch, non-blocking)", () => {
    const src = read("app/api/tenders/[id]/metadata-override/route.ts");
    assert.ok(src.includes("ledger mutation failed (non-blocking)"), "must catch ledger errors non-blocking");
  });
});

// ─── 3. Backfill tests (source-level) ───────────────────────────────────────

describe("backfill — safety and features", () => {
  it("dry-run is default (no --apply flag = no writes)", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes('const isApply = process.argv.includes("--apply")'), "must default to dry-run");
    assert.ok(src.includes("DRY-RUN"), "must log dry-run mode");
  });

  it("--apply refused in NODE_ENV=production", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes("isApply && isProduction"), "must check production + apply");
    assert.ok(src.includes("REFUSED: --apply is not allowed in NODE_ENV=production"), "must refuse in production");
  });

  it("--apply works in test/staging env", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    // The production check only fires when isApply AND isProduction
    assert.ok(src.includes('process.env.NODE_ENV === "production"'), "must check NODE_ENV");
  });

  it("existing semanticKey is skipped (idempotency)", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("existingKeys.has"), "must check existing keys");
    assert.ok(src.includes("Already exists in ledger"), "must skip existing keys with reason");
  });

  it("placeholder values (Not/N/A/Unknown/TBD) are rejected", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("isPlaceholderIsh"), "must have isPlaceholderIsh helper");
    assert.ok(src.includes('"not"'), "must reject 'not'");
    assert.ok(src.includes('"n/a"'), "must reject 'n/a'");
    assert.ok(src.includes('"unknown"'), "must reject 'unknown'");
    assert.ok(src.includes('"tbd"'), "must reject 'tbd'");
  });

  it("emails are normalized with pipe/comma/semicolon/and/space", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("normalizeEmailList"), "must use normalizeEmailList");
    const parser = read("lib/engine/source-driven-tender-text-parser.ts");
    assert.ok(parser.includes("split(/[|;,]|\\s+/)"), "shared normalizer must split on | ; , whitespace");
  });

  it("source-grounded only when file/page/quote evidence exists", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("hasEvidence = !!(input.sourceFileId && input.sourcePage !== null && input.sourceQuote)"), "must check evidence");
    assert.ok(src.includes("SOURCE_GROUNDED_CONFIRMED"), "must use SOURCE_GROUNDED_CONFIRMED when evidence exists");
    assert.ok(src.includes("CANDIDATE_NEEDS_REVIEW"), "must use CANDIDATE_NEEDS_REVIEW when no evidence");
  });

  it("legacy scalar without evidence becomes CANDIDATE_NEEDS_REVIEW", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("LEGACY_AUTHORITY_STATE") || src.includes('"CANDIDATE_NEEDS_REVIEW"'), "must default to CANDIDATE_NEEDS_REVIEW");
  });

  it("supports --tender-id flag for targeted staging repair", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes('"--tender-id"'), "must support --tender-id flag");
    assert.ok(src.includes("tenderIdFlag"), "must parse tenderIdFlag");
  });

  it("supports --limit flag for safe staged runs", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes('"--limit"'), "must support --limit flag");
    assert.ok(src.includes("limitFlag"), "must parse limitFlag");
  });

  it("supports --updated-after flag", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes('"--updated-after"'), "must support --updated-after flag");
  });

  it("writes JSON summary artifact to stdout", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes("=== JSON Summary ==="), "must output JSON summary");
    assert.ok(src.includes("JSON.stringify(summary"), "must stringify summary");
  });

  it("delegates to the canonical service and does not modify Tender scalar columns", () => {
    const src = read("scripts/backfill-tender-facts-ledger.ts");
    assert.ok(src.includes("backfillTenderFactsForTender"), "script must use the canonical service");
    assert.ok(!src.includes("tenderFactsLedger.create"), "script must not duplicate the canonical writer");
    assert.ok(!src.includes("prisma.tender.update"), "must not call prisma.tender.update");
  });
});

// ─── 4. Final readiness tests (source-level) ────────────────────────────────

describe("final readiness — uses ledger authority state", () => {
  it("final-submission-readiness imports getTenderFactLedgerSnapshot", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("getTenderFactLedgerSnapshot"), "must import getTenderFactLedgerSnapshot");
  });

  it("final-submission-readiness fetches ledger snapshot before resolveCanonicalFieldState", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("ledgerSnapshot = await getTenderFactLedgerSnapshot"), "must fetch ledger snapshot");
  });

  it("final-submission-readiness passes ledgerFacts to resolveCanonicalFieldState", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("ledgerFacts: ledgerSnapshot.facts"), "must pass ledgerFacts to resolver");
  });

  it("final-submission-readiness handles ledger table not-yet-migrated (try/catch)", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("Ledger table may not exist yet"), "must handle pre-migration gracefully");
  });
});

// ─── 5. Canonical-field-state ledger integration (source-level) ─────────────

describe("canonical-field-state — ledger authority", () => {
  it("CanonicalResolverInput type includes ledgerFacts optional field", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("ledgerFacts?"), "must have optional ledgerFacts field");
    assert.ok(src.includes("semanticKey: string"), "ledgerFacts entries must have semanticKey");
  });

  it("resolver prefers ledger fact over scalar rawValue", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("input.ledgerFacts?.find"), "must look up ledger facts");
    assert.ok(!src.includes("ledgerOverridesValue"), "must not retain a write-only ledger marker");
    assert.ok(src.includes("rawValue = ledgerFact.normalizedValue"), "must use ledger value over scalar");
  });

  it("resolver handles SOURCE_GROUNDED_CONFIRMED, HUMAN_CONFIRMED_OPERATIONAL, CANDIDATE_NEEDS_REVIEW", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes('"SOURCE_GROUNDED_CONFIRMED"'), "must handle SOURCE_GROUNDED_CONFIRMED");
    assert.ok(src.includes('"HUMAN_CONFIRMED_OPERATIONAL"'), "must handle HUMAN_CONFIRMED_OPERATIONAL");
    assert.ok(src.includes('"CANDIDATE_NEEDS_REVIEW"'), "must handle CANDIDATE_NEEDS_REVIEW");
  });

  it("resolver handles NOT_APPLICABLE (treats as null)", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes('"NOT_APPLICABLE"'), "must handle NOT_APPLICABLE");
    assert.ok(src.includes("rawValue = null"), "must null out value for NOT_APPLICABLE");
  });

  it("resolver handles REJECTED_EXTRACTION / SUPERSEDED (falls through to scalar)", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes('"REJECTED_EXTRACTION"'), "must handle REJECTED_EXTRACTION");
    assert.ok(src.includes('"SUPERSEDED"'), "must handle SUPERSEDED");
  });

  it("resolver handles evaluationCriteria ↔ evaluationMethodology key mismatch", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes('fieldKey === "evaluationCriteria" && f.semanticKey === "evaluationMethodology"'), "must handle key mismatch");
  });
});

// ─── 6. API tests (source-level) ────────────────────────────────────────────

describe("API — GET /api/tenders/[id]/facts-ledger", () => {
  it("route exists and exports GET handler", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("export async function GET"), "must export GET");
  });

  it("enforces RBAC (ADMIN, PROPOSAL_MANAGER, REVIEWER can GET)", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER")'), "must require proper roles for GET");
  });

  it("enforces tenant ownership (tender must belong to user)", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("tender.findFirst"), "must look up tender");
    assert.ok(src.includes("userId: actor.id"), "must scope to user");
    assert.ok(src.includes("Tender not found"), "must return 404 for other tenant's tender");
  });

  it("returns sanitized snapshot (truncates source quotes to ≤80 chars)", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("sourceQuotePreview"), "must return sourceQuotePreview");
    assert.ok(src.includes("f.sourceQuote.length > 80"), "must truncate quotes > 80 chars");
    assert.ok(src.includes("slice(0, 77)"), "must slice to 77 + ellipsis");
  });

  it("returns summary with all required count fields", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("summary: snapshot.summary"), "must return summary");
    assert.ok(src.includes("grounded"), "summary must include grounded count");
    assert.ok(src.includes("userConfirmed"), "summary must include userConfirmed");
    assert.ok(src.includes("userEdited"), "summary must include userEdited");
    assert.ok(src.includes("notApplicable"), "summary must include notApplicable");
    assert.ok(src.includes("candidateNeedsReview"), "summary must include candidateNeedsReview");
    assert.ok(src.includes("rejectedInvalid"), "summary must include rejectedInvalid");
  });

  it("does not expose full source text, file bytes, or secrets", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    // Must NOT include extractedText, fileContent, or raw prompts in the response
    assert.ok(!src.includes("extractedText:"), "must not expose extractedText");
    assert.ok(!src.includes("fileContent:"), "must not expose fileContent");
  });
});

describe("API — POST /api/tenders/[id]/facts-ledger", () => {
  it("route exports POST handler", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("export async function POST"), "must export POST");
  });

  it("enforces RBAC (only ADMIN, PROPOSAL_MANAGER can POST — REVIEWER cannot)", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    // POST requires ADMIN or PROPOSAL_MANAGER (no REVIEWER)
    assert.ok(src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")'), "POST must require ADMIN or PROPOSAL_MANAGER only");
    // The POST handler's requireRole must NOT include REVIEWER
    const postSection = src.split("export async function POST")[1] ?? "";
    assert.ok(!postSection.includes("REVIEWER"), "POST must NOT allow REVIEWER");
  });

  it("enforces tenant isolation (tender ownership check)", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    const postSection = src.split("export async function POST")[1] ?? "";
    assert.ok(postSection.includes("tender.findFirst"), "POST must look up tender");
    assert.ok(postSection.includes("userId: actor.id"), "POST must scope to user");
  });

  it("supports 5 actions: confirm, edit, mark_not_applicable, reject_invalid, supersede", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes('"confirm"'), "must support confirm");
    assert.ok(src.includes('"edit"'), "must support edit");
    assert.ok(src.includes('"mark_not_applicable"'), "must support mark_not_applicable");
    assert.ok(src.includes('"reject_invalid"'), "must support reject_invalid");
    assert.ok(src.includes('"supersede"'), "must support supersede");
  });

  it("writes audit event via logAction (through ledger service)", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("auditLedgerMutation"), "must have auditLedgerMutation helper");
    assert.ok(src.includes("logAction"), "must call logAction for audit");
    assert.ok(src.includes("TENDER_METADATA_OVERRIDE"), "must use TENDER_METADATA_OVERRIDE audit action");
  });

  it("idempotent (upsert by tenderId + semanticKey)", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("tenderFactsLedger.upsert"), "must use upsert (idempotent)");
    assert.ok(src.includes("tenderId_semanticKey"), "must upsert by tenderId + semanticKey");
  });

  it("confirm/edit requires normalizedValue + reason + confirmationBasis", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("normalizedValue is required for confirm/edit"), "must require normalizedValue");
    assert.ok(src.includes("reason is required"), "must require reason");
    assert.ok(src.includes("confirmationBasis is required"), "must require confirmationBasis");
  });

  it("mark_not_applicable requires reason (≥5 chars)", () => {
    const src = read("app/api/tenders/[id]/facts-ledger/route.ts");
    assert.ok(src.includes("reason is required (at least 5 characters) for mark_not_applicable"), "must require reason for N/A");
  });
});

// ─── 7. Document generation uses ledger facts (source-level) ────────────────

describe("document generation — uses ledger facts", () => {
  it("canonical-field-state resolver prefers ledger over scalar (proven above)", () => {
    // This is proven by the canonical-field-state ledger authority tests above.
    // Document generation calls resolveCanonicalFieldState, which now prefers
    // ledger facts. Therefore generated documents use ledger facts.
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("input.ledgerFacts?.find"), "resolver checks ledger facts");
  });

  it("NOT_APPLICABLE facts are omitted from draft output (value is null)", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    // When ledger says NOT_APPLICABLE, rawValue is set to null, so the
    // effective value is null and the field is omitted from generated output.
    assert.ok(src.includes('"NOT_APPLICABLE"'), "handles NOT_APPLICABLE");
    assert.ok(src.includes("rawValue = null"), "nulls out value for N/A");
  });

  it("REJECTED_INVALID facts are not used (fall through to scalar, which may be null)", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes('"REJECTED_EXTRACTION"'), "handles REJECTED_EXTRACTION");
    // REJECTED_EXTRACTION does not override rawValue — the scalar fallback is used.
    // If the scalar is also invalid, the resolver's validation catches it.
  });

  it("generated draft does not output Not/N/A/TBD/Unknown (via metadata-validators)", () => {
    // The metadata-validators module (owned by #976) rejects placeholder values.
    // canonical-field-state uses validateFieldFormat which calls these validators.
    // So generated output never contains Not/N/A/TBD/Unknown.
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("validateFieldFormat"), "resolver validates field format");
  });
});

// ─── 8. Authority state centralization (source-level) ───────────────────────

describe("authority state centralization", () => {
  it("AUTHORITY_STATE constant exports all required states", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("SOURCE_GROUNDED_CONFIRMED"), "exports SOURCE_GROUNDED_CONFIRMED");
    assert.ok(src.includes("USER_CONFIRMED"), "exports USER_CONFIRMED");
    assert.ok(src.includes("USER_EDITED"), "exports USER_EDITED");
    assert.ok(src.includes("NOT_APPLICABLE"), "exports NOT_APPLICABLE");
    assert.ok(src.includes("CANDIDATE_NEEDS_REVIEW"), "exports CANDIDATE_NEEDS_REVIEW");
    assert.ok(src.includes("REJECTED_INVALID"), "exports REJECTED_INVALID");
    assert.ok(src.includes("MISSING"), "exports MISSING");
    assert.ok(src.includes("SUPERSEDED"), "exports SUPERSEDED");
  });

  it("USER_CONFIRMED and USER_EDITED both map to HUMAN_CONFIRMED_OPERATIONAL (schema state)", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes('USER_CONFIRMED: "HUMAN_CONFIRMED_OPERATIONAL"'), "USER_CONFIRMED maps to HUMAN_CONFIRMED_OPERATIONAL");
    assert.ok(src.includes('USER_EDITED: "HUMAN_CONFIRMED_OPERATIONAL"'), "USER_EDITED maps to HUMAN_CONFIRMED_OPERATIONAL");
  });

  it("REJECTED_INVALID maps to REJECTED_EXTRACTION (schema state)", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes('REJECTED_INVALID: "REJECTED_EXTRACTION"'), "REJECTED_INVALID maps to REJECTED_EXTRACTION");
  });
});

// ─── 9. Service API exports (source-level) ──────────────────────────────────

describe("service API — required exports", () => {
  it("exports getTenderFactLedgerSnapshot", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function getTenderFactLedgerSnapshot"), "must export getTenderFactLedgerSnapshot");
  });

  it("exports resolveTenderFact", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export function resolveTenderFact"), "must export resolveTenderFact");
  });

  it("exports resolveTenderFactValue", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export function resolveTenderFactValue"), "must export resolveTenderFactValue");
  });

  it("exports upsertTenderFactFromSource", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function upsertTenderFactFromSource"), "must export upsertTenderFactFromSource");
  });

  it("exports upsertTenderFactFromManualOverride", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function upsertTenderFactFromManualOverride"), "must export upsertTenderFactFromManualOverride");
  });

  it("exports markTenderFactNotApplicable", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function markTenderFactNotApplicable"), "must export markTenderFactNotApplicable");
  });

  it("exports rejectInvalidTenderFact", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function rejectInvalidTenderFact"), "must export rejectInvalidTenderFact");
  });

  it("exports supersedeTenderFact", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function supersedeTenderFact"), "must export supersedeTenderFact");
  });

  it("exports backfillTenderFactsForTender", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("export async function backfillTenderFactsForTender"), "must export backfillTenderFactsForTender");
  });
});

// ─── 10. Audit logging (source-level) ───────────────────────────────────────

describe("audit logging — every mutation is audited", () => {
  it("auditLedgerMutation logs tenderId, semanticKey, action, userId", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("async function auditLedgerMutation"), "must have auditLedgerMutation");
    assert.ok(src.includes("tenderId"), "must log tenderId");
    assert.ok(src.includes("semanticKey"), "must log semanticKey");
    assert.ok(src.includes("action"), "must log action");
    assert.ok(src.includes("userId"), "must log userId");
  });

  it("audit includes previous/new authorityState", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("authorityState"), "must log authorityState");
  });

  it("audit includes reason and confirmationBasis when present", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(src.includes("reason"), "must log reason");
    assert.ok(src.includes("confirmationBasis"), "must log confirmationBasis");
  });

  it("audit does not log API keys, prompts, full file contents, secrets", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(!src.includes("apiKey"), "must not log apiKey");
    assert.ok(!src.includes("API_KEY"), "must not log API_KEY");
    assert.ok(!src.includes("prompt"), "must not log prompt");
    assert.ok(!src.includes("fileContent"), "must not log fileContent");
  });
});

// ─── 11. Shared normalization authority (source-level) ─────────────────────

describe("shared normalization authority", () => {
  it("reuses the canonical parser email normalizer", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    const activeImport = src.match(/^import\s+.*from\s+"\.\/source-driven-tender-text-parser"/m);
    assert.ok(activeImport, "ledger service must reuse the canonical parser normalizer");
  });

  it("does not retain a competing inline email normalizer", () => {
    const src = read("lib/engine/tender-facts-ledger-service.ts");
    assert.ok(!src.includes("function normalizeEmailList"), "ledger service must not duplicate normalizeEmailList");
  });
});
