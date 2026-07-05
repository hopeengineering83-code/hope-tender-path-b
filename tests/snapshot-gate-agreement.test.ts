/**
 * Snapshot ↔ Gate Agreement — Source-Inspection + Decision-Function Tests
 *
 * The release snapshot (lib/engine/tender-release-snapshot.ts) is consumed by
 * ALL UI panels. The generation gate (lib/engine/generation-readiness-gate.ts)
 * is the authoritative gate for generation/export/ZIP. A prior audit (H8)
 * found NO tests verify that the snapshot's metadata.hasGenerationBlocker,
 * requirements.allMandatoryGrounded, and buildPlan.valid agree with the gate's
 * corresponding blockers.
 *
 * This file pins:
 *   1. Input-shape parity — both call resolveCanonicalFieldState with the same
 *      critical source-evidence columns + activeTenderFileIds filtered to ACTIVE.
 *   2. Decision-function parity — the snapshot's metadata blocker agrees with
 *      the gate's METADATA_CRITICAL_FIELD_INVALID for a missing critical field.
 *   3. Known divergences — documents (as regression sentinels) that the
 *      snapshot's buildPlan.valid uses a count check while the gate uses a
 *      6-condition strict check, and that the snapshot's requirements grounding
 *      is looser than the gate's (no quote-containment check).
 *
 * Tier A tests are pure source-inspection (no DB). Tier B tests are pure
 * decision-function (no DB, call evaluateGenerationReadiness +
 * resolveCanonicalFieldState directly). Tier C (DB-integration) tests are
 * deferred to a future commit — they require a fully-migrated PostgreSQL
 * instance and are documented in the audit report.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";

const read = (p: string) => readFileSync(p, "utf8");

// ─── Tier A: Source-inspection — input-shape parity ─────────────────────────

describe("Snapshot ↔ Gate input-shape parity (Tier A source-inspection)", () => {
  const snapshotSrc = read("lib/engine/tender-release-snapshot.ts");
  const gateSrc = read("lib/engine/generation-readiness-gate.ts");

  it("both SELECT referenceSource{Page,Quote,FileId} columns", () => {
    // The resolver reads these dynamically via getSourceEvidence for
    // fieldKey="reference". Both callers must select them so the resolver
    // takes the dedicated-column path (not just the contactDetailsSourceJson
    // fallback).
    for (const col of ["referenceSourcePage", "referenceSourceQuote", "referenceSourceFileId"]) {
      assert.ok(snapshotSrc.includes(`${col}: true`), `snapshot SELECT must include ${col}: true`);
      assert.ok(gateSrc.includes(`${col}: true`), `gate SELECT must include ${col}: true`);
    }
  });

  it("both build activeTenderFileIds from files filtered to deletionStatus=ACTIVE", () => {
    assert.ok(
      snapshotSrc.includes("activeTenderFileIds: new Set(activeFiles.map((f) => f.id))"),
      "snapshot must build activeTenderFileIds from activeFiles (pre-filtered to ACTIVE)",
    );
    assert.ok(
      gateSrc.includes("activeFileIds: activeFileIds") || gateSrc.includes("activeTenderFileIds: activeFileIds"),
      "gate must forward activeFileIds (built from activeFiles filtered to ACTIVE)",
    );
  });

  it("both call resolveCanonicalFieldState (not a parallel metadata-blocker path)", () => {
    assert.ok(
      snapshotSrc.includes("resolveCanonicalFieldState({"),
      "snapshot must call resolveCanonicalFieldState directly",
    );
    assert.ok(
      gateSrc.includes("resolveCanonicalFieldState({"),
      "gate must call resolveCanonicalFieldState directly",
    );
  });

  it("snapshot forwards contactDetailsSourceJson (reference fallback)", () => {
    assert.ok(
      snapshotSrc.includes("contactDetailsSourceJson: tender.contactDetailsSourceJson"),
      "snapshot must forward contactDetailsSourceJson for the reference fallback path",
    );
  });

  it("gate forwards contactDetailsSourceJson (reference fallback)", () => {
    assert.ok(
      gateSrc.includes("contactDetailsSourceJson: tender.contactDetailsSourceJson ?? null"),
      "gate must forward contactDetailsSourceJson for the reference fallback path",
    );
  });
});

// ─── Tier A: Known divergences — source-inspection sentinels ────────────────

describe("Snapshot ↔ Gate known divergences (Tier A sentinels)", () => {
  const snapshotSrc = read("lib/engine/tender-release-snapshot.ts");
  const gateSrc = read("lib/engine/generation-readiness-gate.ts");

  it("DIVERGENCE: snapshot.buildPlan.valid uses generatedDocuments count, not getCurrentConfirmedBuildPlan", () => {
    // The snapshot's buildPlan.valid is `buildPlanCount > 0` where
    // buildPlanCount = tender.generatedDocuments.length (excluding SUPERSEDED).
    // The gate uses a 6-condition strict check including a persisted BuildPlan
    // row, hash match, CONFIRMED status, items validation, and (for export)
    // document reconciliation + export-ready count.
    // This means snapshot.buildPlan.valid can be true while the gate returns
    // BUILD_PLAN_MISSING or BUILD_PLAN_NOT_CONFIRMED.
    // This test DOCUMENTS the divergence so a future fix can replace the
    // snapshot's count check with getCurrentConfirmedBuildPlan.
    assert.ok(
      snapshotSrc.includes("const buildPlanCount = tender.generatedDocuments.length"),
      "snapshot currently uses generatedDocuments.length for buildPlan.valid (known divergence from gate)",
    );
    assert.ok(
      snapshotSrc.includes("valid: buildPlanCount > 0"),
      "snapshot currently uses buildPlanCount > 0 (known divergence from gate's 6-condition check)",
    );
    // The gate uses the strict check
    assert.ok(
      gateSrc.includes("getCurrentConfirmedBuildPlan"),
      "gate uses getCurrentConfirmedBuildPlan (the strict check the snapshot should eventually adopt)",
    );
  });

  it("DIVERGENCE: snapshot requirements grounding does NOT check quote containment in extracted text", () => {
    // The snapshot's groundedMandatory filter checks: sourceTenderFileId in
    // activeFileIds, isGroundedEvidence(page, quote), quote.length >= 10.
    // The gate additionally checks: sourcePage <= totalPages AND the quote
    // is contained (normalized) in the file's extractedText.
    // This means snapshot.requirements.allMandatoryGrounded can be true while
    // the gate returns REQUIREMENT_SOURCE_UNGROUNDED or REQUIREMENT_QUOTE_NOT_IN_FILE.
    assert.ok(
      snapshotSrc.includes("isGroundedEvidence(r.sourcePageNumber, quote)"),
      "snapshot uses isGroundedEvidence (page + quote length only)",
    );
    assert.ok(
      !snapshotSrc.includes("quoteSupported") && !snapshotSrc.includes("extractedText.includes"),
      "snapshot does NOT check quote containment in extracted text (known divergence from gate)",
    );
    // The gate DOES check quote containment
    assert.ok(
      gateSrc.includes("sourceFileExtractedText") || gateSrc.includes("quoteSupported"),
      "gate checks quote containment in the source file's extracted text",
    );
  });

  it("DIVERGENCE: snapshot metadata blocker uses resolver only; gate adds validateCriticalMetadataEvidenceForBuildPlan", () => {
    // The snapshot's metadata.hasGenerationBlocker comes directly from
    // resolveCanonicalFieldState. The gate additionally calls
    // validateCriticalMetadataEvidenceForBuildPlan which enforces quote
    // containment + page <= totalPages.
    assert.ok(
      snapshotSrc.includes("metadata.hasGenerationBlocker"),
      "snapshot uses resolver's hasGenerationBlocker directly",
    );
    assert.ok(
      gateSrc.includes("validateCriticalMetadataEvidenceForBuildPlan"),
      "gate adds validateCriticalMetadataEvidenceForBuildPlan (stricter second-layer check)",
    );
  });
});

// ─── Tier B: Decision-function parity ───────────────────────────────────────

describe("Snapshot ↔ Gate decision-function parity (Tier B)", () => {
  it("resolver says hasGenerationBlocker=true → gate returns METADATA_CRITICAL_FIELD_INVALID", () => {
    // Construct a CanonicalResolverInput where a critical field (deadline) is
    // INVALID (no value, no override). The resolver must set
    // hasGenerationBlocker=true. The gate's evaluateGenerationReadiness must
    // return blockerCode=METADATA_CRITICAL_FIELD_INVALID when
    // criticalMetadataOk=false.
    const resolverResult = resolveCanonicalFieldState({
      tender: {
        id: "tender-1",
        title: "Test Tender",
        reference: null,
        clientName: "Ministry of Test",
        procuringEntityName: null,
        deadline: null, // MISSING — always-critical field
        currency: null,
        country: null,
        submissionMethod: "Email",
        submissionAddress: null,
        submissionEmails: "test@example.com",
        submissionEmailSubject: null,
        clientContactName: null,
        clientContactEmail: null,
        metadataContaminated: false,
        // No source evidence for any field
      },
      overrides: [],
      activeTenderFileIds: new Set(["file-1"]),
      hasExtractedRequirements: true,
    });
    assert.equal(resolverResult.hasGenerationBlocker, true, "resolver must flag blocker for missing deadline");

    // Now call the gate's pure decision function with criticalMetadataOk=false
    // (simulating what the gate would compute from the resolver result).
    const gateResult = evaluateGenerationReadiness({
      purpose: "generate",
      tenderExistsAndOwned: true,
      activeFileCount: 1,
      extractionFiles: [{ fileId: "file-1", corrupted: false, weak: false, hasOverride: false }],
      analysisState: "AI_SUCCEEDED",
      canonicalJobId: "job-1",
      latestJobHash: "hash-1",
      currentContentHash: "hash-1",
      fallbackApprovalBound: false,
      currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
      requirementCount: 1,
      requirements: [{
        priority: "MANDATORY",
        sourceTenderFileId: "file-1",
        sourcePageNumber: 1,
        sourceExactQuote: "A meaningful requirement quote that is long enough.",
        sourceFileActiveInTender: true,
        sourceFileExtractedText: "A meaningful requirement quote that is long enough.",
        sourceFileTotalPages: 5,
      }],
      criticalMetadataOk: false, // mirrors resolverResult.hasGenerationBlocker=true
      recordedBuildPlanState: "VALID",
      hasCurrentConfirmedBuildPlan: true,
      confirmedBuildPlanItemsValid: true,
      exportReadyDocumentCount: 0,
    });
    assert.equal(gateResult.ok, false, "gate must block when criticalMetadataOk=false");
    assert.equal(gateResult.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
  });

  it("resolver says hasGenerationBlocker=false → gate can still block on OTHER conditions", () => {
    // The resolver may say no metadata blocker, but the gate can still block
    // on analysis, chunks, requirements, or build plan. This is NOT a
    // divergence — it's the gate's additional strictness.
    const resolverResult = resolveCanonicalFieldState({
      tender: {
        id: "tender-1",
        title: "Test Tender for Infrastructure Development",
        reference: "REF-2026-001",
        clientName: "Ministry of Test",
        procuringEntityName: null,
        deadline: new Date("2026-12-30"),
        currency: "USD",
        country: "Ethiopia",
        submissionMethod: "Email submission",
        submissionAddress: null,
        submissionEmails: "test@example.com",
        submissionEmailSubject: null,
        clientContactName: null,
        clientContactEmail: null,
        metadataContaminated: false,
        clientNameSourceFileId: "file-1",
        clientNameSourcePage: 1,
        clientNameSourceQuote: "The procuring entity is the Ministry of Test.",
        titleSourceFileId: "file-1",
        titleSourcePage: 1,
        titleSourceQuote: "Tender Notice: Test Tender for Infrastructure Development",
        deadlineSourceFileId: "file-1",
        deadlineSourcePage: 1,
        deadlineSourceQuote: "Submission Deadline: 2026-12-30",
        submissionMethodSourceFileId: "file-1",
        submissionMethodSourcePage: 1,
        submissionMethodSourceQuote: "Submit by Email submission to the address below.",
      },
      overrides: [],
      activeTenderFileIds: new Set(["file-1"]),
      hasExtractedRequirements: true,
    });
    assert.equal(resolverResult.hasGenerationBlocker, false, "all critical fields grounded → no blocker");

    // Gate blocks on analysis state (not metadata)
    const gateResult = evaluateGenerationReadiness({
      purpose: "generate",
      tenderExistsAndOwned: true,
      activeFileCount: 1,
      extractionFiles: [{ fileId: "file-1", corrupted: false, weak: false, hasOverride: false }],
      analysisState: "NOT_STARTED", // gate blocks here
      canonicalJobId: null,
      latestJobHash: null,
      currentContentHash: "hash-1",
      fallbackApprovalBound: false,
      currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
      requirementCount: 1,
      requirements: [{
        priority: "MANDATORY",
        sourceTenderFileId: "file-1",
        sourcePageNumber: 1,
        sourceExactQuote: "A meaningful requirement quote that is long enough.",
        sourceFileActiveInTender: true,
        sourceFileExtractedText: "A meaningful requirement quote that is long enough.",
        sourceFileTotalPages: 5,
      }],
      criticalMetadataOk: true,
      recordedBuildPlanState: "VALID",
      hasCurrentConfirmedBuildPlan: true,
      confirmedBuildPlanItemsValid: true,
      exportReadyDocumentCount: 0,
    });
    assert.equal(gateResult.ok, false);
    assert.equal(gateResult.blockerCode, "ANALYSIS_NOT_READY");
  });
});
