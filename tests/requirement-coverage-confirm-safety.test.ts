import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("automatic requirement coverage safety", () => {
  const panel = readFileSync("components/requirement-coverage-panel.tsx", "utf8");
  const coverageRoute = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");
  const syncRoute = readFileSync("app/api/tenders/[id]/requirement-coverage/auto-sync/route.ts", "utf8");
  const confirmRoute = readFileSync("app/api/tenders/[id]/requirement-coverage/confirm/route.ts", "utf8");
  const worker = readFileSync("lib/ai-job-handlers.ts", "utf8");
  const audit = readFileSync("lib/audit.ts", "utf8");

  it("reads persisted coverage without making panel-open the workflow authority", () => {
    const syncIndex = panel.indexOf("/requirement-coverage/auto-sync");
    const readIndex = panel.indexOf("/requirement-coverage`, { cache: \"no-store\" }");
    assert.ok(syncIndex >= 0, "automatic synchronization endpoint must be called");
    assert.ok(readIndex >= 0, "persisted coverage must be read directly");
    assert.ok(syncIndex > readIndex, "the POST may be exposed only as an explicit recovery path after the canonical read path");
    assert.match(panel, /method:\s*"POST"/);
    assert.match(panel, /manualConfirmationRequired:\s*false/);
    assert.match(panel, /no confirmation click is required/i);
  });

  it("removes the manual confirmation bureaucracy from the live panel", () => {
    assert.doesNotMatch(panel, /Confirm all as partial/);
    assert.doesNotMatch(panel, /Confirm partial evidence/);
    assert.doesNotMatch(panel, /Confirm FULL/);
    assert.doesNotMatch(panel, /Confirm SUBSTANTIAL/);
    assert.doesNotMatch(panel, /Mark N\/A/);
    assert.doesNotMatch(panel, /requirement-coverage\/confirm/);
    assert.doesNotMatch(panel, /requirement-coverage\/reject/);
    assert.doesNotMatch(panel, /Run source extraction or add manually/);
    assert.doesNotMatch(panel, /No source ref/);
    assert.match(panel, /Durable automatic resolution is running/);
    assert.match(panel, /Persisted evidence links/);
  });

  it("keeps automatic evidence fail-closed and persisted", () => {
    assert.match(syncRoute, /reconcileAutomaticRequirementCoverage/);
    assert.match(syncRoute, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(syncRoute, /manualConfirmationRequired:\s*false/);
    assert.match(coverageRoute, /Only persisted links are shown or counted/);
    assert.match(coverageRoute, /parseAutomaticRequirementEvidence/);
    assert.match(coverageRoute, /manualConfirmationRequired:\s*false/);
    assert.match(worker, /reconcileAutomaticRequirementCoverage/);
    assert.match(audit, /AUTOMATIC_REQUIREMENT_COVERAGE_RECONCILED/);
  });

  it("uses the canonical source-verification authority instead of literal REVIEWED labels", () => {
    assert.match(panel, /manualConfirmationRequired:\s*false/);
    assert.doesNotMatch(panel, /manually link evidence/i);
    assert.match(panel, /no confirmation click is required/i);
  });

  it("keeps the old direct-confirm endpoint fail-closed for provenance promotion", () => {
    assert.match(confirmRoute, /REQUIREMENT_SOURCE_GROUNDING_REQUIRED/);
    assert.match(confirmRoute, /confirmation click cannot establish requirement provenance/i);
    assert.doesNotMatch(confirmRoute, /REQUIREMENT_COVERAGE_MANUALLY_CONFIRMED/);
    assert.match(confirmRoute, /requested === "FULL" \|\| requested === "SUBSTANTIAL"/);
    assert.match(confirmRoute, /level:\s*"PARTIAL"/);
    assert.match(confirmRoute, /supportLevelCapped/);
    assert.match(confirmRoute, /requestedSupportLevel/);
  });
});
