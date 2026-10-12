// Phase 26 quality-gap regression tests.
//
// Coverage:
//   1. The live Final ZIP owner persists verified package bytes atomically.
//   2. final-submission-readiness: SUBMISSION_PLAN_DOCUMENTS_MISSING blocker.
//   3. final-submission-readiness: MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const downloadRouteSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/download/route.ts"),
  "utf-8",
);
const persistenceSource = readFileSync(
  path.join(process.cwd(), "lib/engine/export-package-persistence.ts"),
  "utf-8",
);
const exportPreflightSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/export/route.ts"),
  "utf-8",
);

describe("Final ZIP package persistence authority", () => {
  it("the live download route persists only after actual archive assembly", () => {
    const assemblyIdx = downloadRouteSource.indexOf("assembleFinalSubmissionZip");
    const persistIdx = downloadRouteSource.indexOf("persistVerifiedExportPackageDownload");
    assert.ok(assemblyIdx > -1 && persistIdx > assemblyIdx);
    assert.match(downloadRouteSource, /packageSha256:\s*assembledZip\.packageSha256/);
    assert.match(downloadRouteSource, /manifestJson:\s*JSON\.stringify\(assembledZip\.manifest\)/);
  });

  it("the persistence owner locks the tenant-owned tender and commits lifecycle state atomically", () => {
    assert.match(persistenceSource, /prisma\.\$transaction/);
    assert.match(persistenceSource, /FOR UPDATE/);
    assert.match(persistenceSource, /tx\.exportPackage\.(?:create|update)/);
    assert.match(persistenceSource, /tx\.tender\.update/);
    assert.match(persistenceSource, /status:\s*"EXPORTED",\s*stage:\s*"EXPORT"/);
  });

  it("the old POST export route is a non-mutating preflight", () => {
    assert.match(exportPreflightSource, /readyToDownload:\s*true/);
    assert.match(exportPreflightSource, /persistedPackageCreated:\s*false/);
    assert.doesNotMatch(exportPreflightSource, /exportPackage\.(?:findFirst|create|update|updateMany)/);
    assert.doesNotMatch(exportPreflightSource, /status:\s*"EXPORTED"/);
  });
});

const readinessSource = readFileSync(
  path.join(process.cwd(), "lib/engine/final-submission-readiness.ts"),
  "utf-8",
);

describe("final-submission-readiness.ts — SUBMISSION_PLAN_DOCUMENTS_MISSING blocker", () => {
  it("defines the SUBMISSION_PLAN_DOCUMENTS_MISSING category", () => {
    assert.ok(readinessSource.includes("SUBMISSION_PLAN_DOCUMENTS_MISSING"));
  });

  it("fires only when missingPlan.length > 0 AND hasExplicitPlanScope", () => {
    assert.match(readinessSource, /missingPlan\.length\s*>\s*0\s*&&\s*hasExplicitPlanScope/);
  });

  it("lists missing document names in the blocker title", () => {
    const idx = readinessSource.indexOf("SUBMISSION_PLAN_DOCUMENTS_MISSING");
    assert.ok(idx > -1);
    assert.ok(readinessSource.slice(idx, idx + 400).includes("missingPlan.map"));
  });

  it("has HIGH severity", () => {
    const idx = readinessSource.indexOf("SUBMISSION_PLAN_DOCUMENTS_MISSING");
    assert.ok(idx > -1);
    assert.ok(readinessSource.slice(idx, idx + 300).includes('"HIGH"'));
  });
});

describe("final-submission-readiness.ts — MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker", () => {
  it("defines the MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN category", () => {
    assert.ok(readinessSource.includes("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"));
  });

  it("guards on no plan scope plus mandatory requirements", () => {
    assert.match(
      readinessSource,
      /requiredPlanCount\s*===\s*0\s*&&\s*!hasExplicitPlanScope\s*&&\s*mandatoryRequirements\.length\s*>\s*0/,
    );
  });

  it("has HIGH severity and recommends Build Plan", () => {
    const idx = readinessSource.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN");
    assert.ok(idx > -1);
    const window = readinessSource.slice(idx, idx + 400);
    assert.ok(window.includes('"HIGH"'));
    assert.match(window, /Build Plan/i);
  });
});

describe("final-submission-readiness.ts — mandatoryRequirements declaration order", () => {
  it("declares mandatoryRequirements once before both plan blockers", () => {
    const declaration = readinessSource.indexOf("const mandatoryRequirements");
    assert.ok(declaration > -1);
    assert.ok(declaration < readinessSource.indexOf("SUBMISSION_PLAN_DOCUMENTS_MISSING"));
    assert.ok(declaration < readinessSource.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"));
    assert.equal(readinessSource.split("const mandatoryRequirements").length - 1, 1);
  });
});
