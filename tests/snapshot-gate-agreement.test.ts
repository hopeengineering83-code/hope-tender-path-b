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
 *      the gate's TENDER_FACTS_INVALID (renamed from METADATA_CRITICAL_FIELD_INVALID)
 *      for a missing critical field on final export.
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

// ─── Tier A: BuildPlan divergence (resolved via gateValid) + metadata divergence ─

describe("Snapshot ↔ Gate buildPlan + metadata alignment (Tier A)", () => {
  const snapshotSrc = read("lib/engine/tender-release-snapshot.ts");
  const gateSrc = read("lib/engine/generation-readiness-gate.ts");

  it("RESOLVED: snapshot exposes gateValid via getCurrentConfirmedBuildPlan (buildPlan divergence closed)", () => {
    // The snapshot's buildPlan.valid is still a count check (retained for
    // backward-compatible UI display), but the snapshot NOW ALSO exposes
    // buildPlan.gateValid — a gate-aligned strict check computed via the SAME
    // helpers the gate uses (computeTenderBuildPlanHash + getCurrentConfirmedBuildPlan
    // + validateBuildPlanItemsAtRuntime). Consumers that need gate-parity can
    // read gateValid instead of valid.
    assert.ok(
      snapshotSrc.includes("gateValid"),
      "snapshot must expose gateValid (gate-aligned strict check)",
    );
    assert.ok(
      snapshotSrc.includes("gateBlocker"),
      "snapshot must expose gateBlocker (first strict-check failure reason)",
    );
    assert.ok(
      snapshotSrc.includes("computeTenderBuildPlanHash"),
      "snapshot must call computeTenderBuildPlanHash (same helper as the gate)",
    );
    assert.ok(
      snapshotSrc.includes("getCurrentConfirmedBuildPlan"),
      "snapshot must call getCurrentConfirmedBuildPlan (same helper as the gate)",
    );
    assert.ok(
      snapshotSrc.includes("validateBuildPlanItemsAtRuntime"),
      "snapshot must call validateBuildPlanItemsAtRuntime (same helper as the gate)",
    );
    // The count-based valid is still there for backward compatibility
    assert.ok(
      snapshotSrc.includes("valid: buildPlanCount > 0"),
      "snapshot retains count-based valid for backward-compatible UI display",
    );
  });

  it("RESOLVED: snapshot requirements grounding checks quote containment + page-bounds (divergence closed)", () => {
    // The snapshot's groundedMandatory filter now mirrors the gate's check:
    // sourcePage <= totalPages AND the quote is contained (normalized) in the
    // file's extractedText. This keeps snapshot.requirements.allMandatoryGrounded
    // in lock-step with the gate's REQUIREMENT_SOURCE_UNGROUNDED /
    // REQUIREMENT_QUOTE_NOT_IN_FILE blockers.
    assert.ok(
      snapshotSrc.includes("fileText.includes(normalizedQuote)"),
      "snapshot must check quote containment in extracted text (mirrors gate)",
    );
    assert.ok(
      snapshotSrc.includes("r.sourcePageNumber > file.totalPages"),
      "snapshot must check sourcePage <= totalPages (mirrors gate)",
    );
    assert.ok(
      snapshotSrc.includes("totalPages: true"),
      "snapshot SELECT must include totalPages (required for the page-bounds check)",
    );
  });

  it("RESOLVED: snapshot exposes metadata.gateValid via validateCriticalMetadataEvidenceForBuildPlan (metadata divergence closed)", () => {
    // The snapshot's metadata now exposes gateValid + gateBlocker — a gate-aligned
    // strict check computed via the SAME pure helper the gate uses
    // (validateCriticalMetadataEvidenceForBuildPlan). The existing
    // hasGenerationBlocker (resolver-only) is retained for backward-compatible
    // UI display. This closes the LAST snapshot/gate divergence.
    assert.ok(
      snapshotSrc.includes("metadataGateValid") || snapshotSrc.includes("gateValid: metadataGateValid"),
      "snapshot must compute metadataGateValid (gate-aligned strict check)",
    );
    assert.ok(
      snapshotSrc.includes("metadataGateBlocker") || snapshotSrc.includes("gateBlocker: metadataGateBlocker"),
      "snapshot must expose metadataGateBlocker",
    );
    assert.ok(
      snapshotSrc.includes("validateCriticalMetadataEvidenceForBuildPlan"),
      "snapshot must call validateCriticalMetadataEvidenceForBuildPlan (same helper as the gate)",
    );
    // Additive: existing resolver-based blocker retained for backward compatibility
    assert.ok(
      snapshotSrc.includes("metadata.hasGenerationBlocker"),
      "snapshot retains metadata.hasGenerationBlocker for backward-compatible UI display",
    );
    // The 3 email-subject source columns must now be SELECTed (were missing before)
    for (const col of ["submissionEmailSubjectSourcePage", "submissionEmailSubjectSourceQuote", "submissionEmailSubjectSourceFileId"]) {
      assert.ok(
        snapshotSrc.includes(`${col}: true`),
        `snapshot SELECT must include ${col}: true (required by the validator)`,
      );
    }
  });
});

// ─── Tier B: Decision-function parity ───────────────────────────────────────

describe("Snapshot ↔ Gate decision-function parity (Tier B)", () => {
  it("resolver reports hasExportBlocker=true AND gate BLOCKS export with TENDER_FACTS_INVALID", () => {
    // After the tender-facts restoration: the resolver still computes
    // hasExportBlocker=true for missing critical fields (advisory signal for
    // UI display), AND the gate now FAIL-CLOSES final export on
    // criticalMetadataOk=false with TENDER_FACTS_INVALID (renamed from
    // METADATA_CRITICAL_FIELD_INVALID). The resolver and gate AGREE that
    // unsafe tender facts block final output — only draft generation is
    // advisory.
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
    // Resolver still reports the advisory blocker state for UI display.
    assert.equal(resolverResult.hasGenerationBlocker, false, "draft must NOT be blocked by missing deadline (authority model)");
    assert.equal(resolverResult.hasExportBlocker, true, "resolver reports hasExportBlocker=true for missing critical field");

    // Gate FAIL-CLOSES final export on criticalMetadataOk=false with
    // TENDER_FACTS_INVALID (renamed from METADATA_CRITICAL_FIELD_INVALID).
    const gateResultExport = evaluateGenerationReadiness({
      purpose: "export",
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
      criticalMetadataOk: false, // export MUST fail-closed on unsafe tender facts
      recordedBuildPlanState: "VALID",
      hasCurrentConfirmedBuildPlan: true,
      confirmedBuildPlanItemsValid: true,
      exportReadyDocumentCount: 1,
    });
    assert.equal(gateResultExport.ok, false, "export gate MUST block on criticalMetadataOk=false (fail-closed)");
    assert.equal(gateResultExport.blockerCode, "TENDER_FACTS_INVALID");
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
        // Ground the reference — it's value-driven evidence-mandatory.
        referenceSourceFileId: "file-1",
        referenceSourcePage: 1,
        referenceSourceQuote: "The reference number is REF-2026-001 for this tender.",
        // Ground the email endpoint — submissionEmails is critical on an
        // email-method tender (the BuildPlan validator hard-requires it).
        submissionEmailSourceFileId: "file-1",
        submissionEmailSourcePage: 1,
        submissionEmailSourceQuote: "Submit bids by email to test@example.com before the deadline.",
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
