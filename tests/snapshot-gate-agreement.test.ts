/**
 * Snapshot ↔ Gate Agreement — source-shape and decision-function tests.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";

const read = (p: string) => readFileSync(p, "utf8");

function snapshotBuildsActiveIds(src: string): boolean {
  const activeFilter = /const activeFiles = tender\.files\.filter\(\(\w+\) => \w+\.deletionStatus === "ACTIVE"\)/.test(src);
  const inline = /activeTenderFileIds:\s*new Set\(activeFiles\.map\(\(\w+\) => \w+\.id\)\)/.test(src);
  const declared = /const activeTenderFileIds = new Set\(activeFiles\.map\(\(\w+\) => \w+\.id\)\)/.test(src)
    && /activeTenderFileIds,/.test(src);
  return activeFilter && (inline || declared);
}

describe("Snapshot ↔ Gate input-shape parity", () => {
  const snapshotSrc = read("lib/engine/tender-release-snapshot.ts");
  const gateSrc = read("lib/engine/generation-readiness-gate.ts");

  it("both SELECT reference source columns", () => {
    for (const col of ["referenceSourcePage", "referenceSourceQuote", "referenceSourceFileId"]) {
      assert.ok(snapshotSrc.includes(`${col}: true`));
      assert.ok(gateSrc.includes(`${col}: true`));
    }
  });

  it("both derive active source IDs only from active files", () => {
    assert.ok(snapshotBuildsActiveIds(snapshotSrc), "snapshot must derive IDs from pre-filtered activeFiles");
    assert.match(gateSrc, /activeFileIds:\s*activeFileIds|activeTenderFileIds:\s*activeFileIds/);
  });

  it("both call the canonical field resolver", () => {
    assert.ok(snapshotSrc.includes("resolveCanonicalFieldState({"));
    assert.ok(gateSrc.includes("resolveCanonicalFieldState({"));
  });

  it("both forward the contact-details source ledger", () => {
    assert.match(snapshotSrc, /contactDetailsSourceJson:\s*tender\.contactDetailsSourceJson(?:\s*\?\?\s*null)?/);
    assert.match(gateSrc, /contactDetailsSourceJson:\s*tender\.contactDetailsSourceJson\s*\?\?\s*null/);
  });
});

describe("Snapshot ↔ Gate Build Plan, requirement, and metadata alignment", () => {
  const snapshotSrc = read("lib/engine/tender-release-snapshot.ts");

  it("uses the strict shared Build Plan helpers while retaining display-only count state", () => {
    assert.match(snapshotSrc, /computeTenderBuildPlanHash/);
    assert.match(snapshotSrc, /getCurrentConfirmedBuildPlan/);
    assert.match(snapshotSrc, /validateBuildPlanItemsAtRuntime/);
    assert.match(snapshotSrc, /valid:\s*buildPlanCount > 0/);
    assert.match(snapshotSrc, /gateValid:\s*buildPlanGateValid/);
  });

  it("checks quote containment and source page bounds", () => {
    assert.match(snapshotSrc, /fileText\.length > 0 && fileText\.includes\(normalizedQuote\)/);
    assert.match(
      snapshotSrc,
      /requirement\.sourcePageNumber > sourceFile\.totalPages|r\.sourcePageNumber > file\.totalPages/,
    );
    assert.match(snapshotSrc, /totalPages:\s*true/);
  });

  it("uses the shared strict metadata-evidence validator", () => {
    assert.match(snapshotSrc, /validateCriticalMetadataEvidenceForBuildPlan/);
    assert.match(snapshotSrc, /metadataGateValid/);
    assert.match(snapshotSrc, /metadataGateBlocker/);
    assert.match(snapshotSrc, /metadata\.hasGenerationBlocker/);
    for (const col of [
      "submissionEmailSubjectSourcePage",
      "submissionEmailSubjectSourceQuote",
      "submissionEmailSubjectSourceFileId",
    ]) assert.ok(snapshotSrc.includes(`${col}: true`));
  });
});

describe("Snapshot ↔ Gate decision-function parity", () => {
  it("canonical metadata export blockers are respected by the generation gate", () => {
    const canonical = resolveCanonicalFieldState({
      tender: {
        id: "tender-1",
        title: "Valid tender title",
        reference: null,
        clientName: "Valid Client",
        deadline: new Date("2027-01-01T00:00:00Z"),
        currency: "ETB",
        country: "Ethiopia",
        submissionMethod: "EMAIL",
        submissionAddress: null,
        submissionEmails: "submit@example.test",
        submissionEmailSubject: "Tender submission",
        metadataContaminated: false,
      },
      overrides: [],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(),
    });
    assert.equal(canonical.hasExportBlocker, true);

    const gate = evaluateGenerationReadiness({
      activeFiles: [],
      analysisState: "AI_SUCCEEDED",
      canonicalAnalysisJobId: "job-1",
      contentHashMatch: true,
      metadataHasGenerationBlocker: canonical.hasGenerationBlocker,
      metadataHasExportBlocker: canonical.hasExportBlocker,
      mandatoryRequirements: [],
      hasCurrentConfirmedBuildPlan: true,
      confirmedBuildPlanItemsValid: true,
      generationEligibleVaultEvidence: true,
      finalHumanReviewedVaultEvidence: false,
      generatedDocuments: [],
      finalExportAllowed: false,
    });
    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.code === "TENDER_FACTS_INVALID"));
  });
});
