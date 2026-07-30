import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assessCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { buildReleaseSnapshotEligibility } from "../lib/engine/release-snapshot-eligibility";

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

  it("refreshes Vault source links and verification before sync or queued Engine execution", () => {
    const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    const registry = readFileSync("lib/ai-job-handlers.ts", "utf8");
    const preflight = route.indexOf("prepareCompanyVaultForEngine(userId)");
    const asyncBranch = route.indexOf('searchParams.get("async")');
    const syncRun = route.indexOf("runTenderEngine(id, userId");

    assert.ok(preflight >= 0, "Engine route must call the Company Vault preflight");
    assert.ok(asyncBranch > preflight, "Vault promotion must complete before async enqueue");
    assert.ok(syncRun > preflight, "Vault promotion must complete before synchronous execution");
    assert.match(registry, /jobType === "ENGINE_RUN"/);
    assert.match(registry, /prepareCompanyVaultForEngine\(ctx\.userId\)/);
    assert.ok(
      registry.indexOf("prepareCompanyVaultForEngine(ctx.userId)") < registry.lastIndexOf("legacyHandler(ctx)"),
      "Queued Engine execution must refresh Vault authority before invoking the legacy handler",
    );
  });

  it("keeps automatic promotion source-backed and fail-closed globally", () => {
    const authority = readFileSync("lib/vault-review-provenance.ts", "utf8");
    const runtimeAuthority = readFileSync("lib/vault-runtime-authority.ts", "utf8");
    const preflight = readFileSync("lib/engine/prepare-company-vault.ts", "utf8");
    assert.match(authority, /return isDurablyReviewed\(record\) \|\| isDurablySourceVerified\(record\)/);
    assert.match(runtimeAuthority, /isDurablySourceVerified/);
    assert.match(runtimeAuthority, /isDurablyReviewed/);
    assert.match(preflight, /remapUnlinkedVaultSources/);
    assert.match(preflight, /autoVerifyCompanyKnowledge/);
    assert.doesNotMatch(preflight, /reviewedBy:\s*["']SYSTEM_AUTO_VERIFIED/);
    assert.doesNotMatch(authority, /all non-expired company records are usable/i);
  });

  it("removes mandatory review controls from the active Company Vault page", () => {
    const page = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
    const view = readFileSync("components/company-vault-verification-page.tsx", "utf8");
    assert.match(page, /company-vault-verification-page/);
    assert.match(view, /No human approval step is required/);
    assert.doesNotMatch(view, />Review & approve<|>Click review to approve<|>Await human review</i);
  });
});
