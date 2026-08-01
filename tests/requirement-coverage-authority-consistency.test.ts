import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

const read = (path: string) => readFileSync(path, "utf8");

describe("requirement coverage authority consistency", () => {
  it("derives effective display status from active source-contained evidence", () => {
    const requirement = {
      id: "requirement-1",
      title: "Technical Proposal",
      priority: "MANDATORY",
      requirementType: "FORM",
      sourceTenderFileId: "file-1",
      sourcePageNumber: 1,
      sourceExactQuote: "Submit one complete technical proposal document.",
      complianceMatrixRows: [{ supportLevel: "FULL" }],
    };
    const activeFiles = [{
      id: "file-1",
      extractedText: "Instructions: Submit one complete technical proposal document.",
      totalPages: 3,
    }];

    assert.equal(
      mapRequirementsToEvidence([requirement], [], [], activeFiles)[0]?.displayStatus,
      "FULLY_MET",
    );
    assert.equal(
      mapRequirementsToEvidence(
        [{ ...requirement, sourceTenderFileId: "foreign-file" }],
        [],
        [],
        activeFiles,
      )[0]?.displayStatus,
      "NEEDS_TRACE",
    );
    assert.equal(
      mapRequirementsToEvidence(
        [{ ...requirement, complianceMatrixRows: [{ supportLevel: "NOT_APPLICABLE" }] }],
        [],
        [],
        activeFiles,
      )[0]?.displayStatus,
      "NOT_MET",
    );
  });

  it("strong manual confirmation verifies active source containment", () => {
    const route = read("app/api/tenders/[id]/requirement-coverage/confirm/route.ts");
    assert.match(route, /isGroundedEvidenceInActiveFiles/);
    assert.match(route, /deletionStatus:\s*"ACTIVE"/);
    assert.match(route, /REQUIREMENT_SOURCE_TRACE_REQUIRED/);
  });

  it("removes the competing direct support-level mutator", () => {
    assert.equal(
      existsSync("app/api/tenders/[id]/requirement-coverage/set-support-level/route.ts"),
      false,
    );
    const panel = read("components/requirement-coverage-panel.tsx");
    assert.doesNotMatch(panel, /set-support-level/);
    assert.doesNotMatch(panel, /Fallback: try direct compliance matrix update/);
  });

  it("the sole coverage surface consumes the canonical effective status", () => {
    const api = read("app/api/tenders/[id]/requirement-coverage/route.ts");

    assert.match(api, /canonicalStatus\?\.displayStatus/);
    assert.match(api, /getFinalPackageReadinessModel/);
  });

  it("workflow snapshot and lifecycle controls reuse the effective selector", () => {
    const snapshot = read("lib/engine/tender-release-snapshot.ts");
    const lifecycle = read("lib/engine/tender-lifecycle-orchestrator.ts");

    assert.match(snapshot, /mapRequirementsToEvidence/);
    assert.match(snapshot, /status\.displayStatus === "FULLY_MET"/);
    assert.doesNotMatch(snapshot, /STRONG_SUPPORT/);
    assert.match(lifecycle, /mapRequirementsToEvidence/);
    assert.match(lifecycle, /canonicalStatusByRequirementId/);
    assert.doesNotMatch(lifecycle, /isStrongSupportLevel/);
  });
});
