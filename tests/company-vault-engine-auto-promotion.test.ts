import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assessCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { buildReleaseSnapshotEligibility } from "../lib/engine/release-snapshot-eligibility";
import { type ReviewRecordState } from "../lib/vault-review-provenance";
import { canUseVaultRecordSafely } from "../lib/vault-runtime-authority";

describe("Company Vault automatic runtime authority", () => {
  it("treats SOURCE_VERIFIED evidence as ready without a mandatory human step", () => {
    const result = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "Verified company evidence ".repeat(10) }],
      experts: [{ trustLevel: "SOURCE_VERIFIED" }],
      projects: [{ trustLevel: "SOURCE_VERIFIED" }],
    });

    assert.equal(result.ingestionReady, true);
    assert.deepEqual(result.blockers, []);
    assert.doesNotMatch(result.warnings.join(" "), /human review|review board|final export/i);
  });

  it("does not add a second human-only Vault gate to export or Final ZIP", () => {
    const result = buildReleaseSnapshotEligibility({
      extractionBlocker: null,
      analysisBlocker: null,
      metadataGenerationBlocker: null,
      metadataFinalBlocker: null,
      requirementsBlocker: null,
      buildPlanGateBlocker: null,
      matchingVaultBlocker: null,
      finalApprovalVaultBlocker: "Legacy human-only Vault approval blocker.",
      mandatoryRequirementCount: 0,
      evidenceCoveragePercent: 0,
      allMandatoryGrounded: true,
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, true);
    assert.equal(result.finalZipEligible, true);
  });

  it("commits Vault verification before the canonical durable enqueue authority", () => {
    const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    const enqueue = readFileSync("lib/engine/enqueue-engine-job.ts", "utf8");
    const registry = readFileSync("lib/ai-job-handlers.ts", "utf8");
    const preflight = route.indexOf("prepareCompanyVaultForEngine(userId)");
    const enqueueCall = route.indexOf("enqueueEngineJobForCurrentSources(prisma");

    assert.ok(preflight >= 0, "Engine route must call the Company Vault preflight");
    assert.ok(enqueueCall > preflight, "durable enqueue must use post-promotion authority");
    assert.match(enqueue, /computeEngineSourceRevision/);
    assert.match(enqueue, /pg_advisory_xact_lock/);
    assert.match(enqueue, /tx\.aiJob\.create/);
    assert.doesNotMatch(route, /runTenderEngine/);
    assert.doesNotMatch(route, /searchParams\.get\("async"\)\s*===\s*"true"/);

    assert.match(registry, /jobType === "ENGINE_RUN"/);
    assert.match(registry, /prepareCompanyVaultForEngine\(ctx\.userId\)/);
    assert.match(registry, /checkpoint:\s*"before"/);
    assert.match(registry, /checkpoint:\s*"after"/);
    assert.ok(
      registry.indexOf("prepareCompanyVaultForEngine(ctx.userId)") < registry.lastIndexOf("legacyHandler(ctx)"),
      "Queued Engine execution must refresh Vault authority before invoking the actual Engine handler",
    );
  });

  it("continues a successful analysis with the manual Run Engine boundary", () => {
    const registry = readFileSync("lib/ai-job-handlers.ts", "utf8");
    assert.match(registry, /jobType === "AI_ANALYZE"/);
    // The AI Analyze handler records the manual boundary — no auto-continuation.
    assert.match(registry, /manual-engine-required/);
    assert.match(registry, /automaticEngineStarted: false/);
    assert.match(registry, /nextAction: "RUN_ENGINE"/);
  });

  it("keeps automatic promotion source-backed and fail-closed globally", () => {
    const authority = readFileSync("lib/vault-review-provenance.ts", "utf8");
    const preflight = readFileSync("lib/engine/prepare-company-vault.ts", "utf8");
    assert.match(authority, /return isDurablyReviewed\(record\) \|\| isDurablySourceVerified\(record\)/);
    assert.match(preflight, /remapUnlinkedVaultSources/);
    assert.match(preflight, /autoVerifyCompanyKnowledge/);
    assert.doesNotMatch(preflight, /reviewedBy:\s*["']SYSTEM_AUTO_VERIFIED/);
    assert.doesNotMatch(authority, /all non-expired company records are usable/i);

    // This used to also require lib/vault-runtime-authority.ts to literally
    // contain "isDurablySourceVerified" and "isDurablyReviewed". That was an
    // assertion about the file's text, and it held only because that file
    // carried its own copy of the rule — the very duplication that made one
    // decision have two implementations. canUseVaultRecordSafely now delegates
    // to canUseVaultRecord, so the identifiers are gone from that file while
    // the behaviour is identical. Assert the behaviour instead: the runtime
    // entry point must still refuse a draft and must still refuse a
    // SOURCE_VERIFIED record wearing fabricated reviewer metadata.
    // tests/vault-evidence-policy-single-authority.test.ts proves full
    // equivalence across every distinguishing state.
    assert.equal(canUseVaultRecordSafely({ trustLevel: "AI_DRAFT" } as ReviewRecordState, "GENERATION"), false);
    assert.equal(
      canUseVaultRecordSafely(
        {
          trustLevel: "SOURCE_VERIFIED",
          sourceDocumentId: "doc-1",
          reviewedBy: "system",
          reviewedAt: new Date(),
          reviewNotes: null,
        } as ReviewRecordState,
        "GENERATION",
      ),
      false,
    );
  });

  it("removes mandatory review controls from the active Company Vault page", () => {
    const page = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
    const view = readFileSync("components/company-vault-verification-page.tsx", "utf8");
    assert.match(page, /company-vault-verification-page/);
    assert.match(view, /No human approval step is required/);
    assert.doesNotMatch(view, />Review & approve<|>Click review to approve<|>Await human review</i);
  });
});
