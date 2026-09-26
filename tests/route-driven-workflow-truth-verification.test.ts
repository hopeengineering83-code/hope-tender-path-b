import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPublicReadinessAgreement,
  buildPublicReadinessEnvelope,
  type PublicReadinessEnvelope,
} from "../lib/engine/public-readiness-envelope";

const PANEL_ROUTE_FILES = [
  "app/api/tenders/[id]/lifecycle/route.ts",
  "app/api/tenders/[id]/readiness-score/route.ts",
  "app/api/tenders/[id]/generation-readiness/route.ts",
  "app/api/tenders/[id]/export-readiness/route.ts",
  "app/api/tenders/[id]/workflow-status/route.ts",
  "app/api/tenders/[id]/route.ts",
];

const DIRECT_PACKAGE_ROUTES = [
  "app/api/tenders/[id]/generation-readiness/route.ts",
  "app/api/tenders/[id]/export-readiness/route.ts",
  "app/api/tenders/[id]/workflow-status/route.ts",
];

const DELEGATED_AUTHORITY_ROUTES: Record<string, RegExp> = {
  "app/api/tenders/[id]/lifecycle/route.ts": /computeTenderLifecycle/,
  "app/api/tenders/[id]/readiness-score/route.ts": /getFinalSubmissionReadiness/,
};

const SERVER_ERROR_TERMS = /\b(PrismaClientKnownRequestError|PrismaClient|stack trace|TypeError|ReferenceError|DATABASE_URL|SESSION_SECRET)\b/i;
const USER_FACING_METADATA_TERMS = /\b(metadata|Prisma|stack trace|Server Error|TypeError|ReferenceError)\b/i;

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

function blocked(route: string, overrides: Partial<Parameters<typeof buildPublicReadinessEnvelope>[0]>): PublicReadinessEnvelope & { route: string } {
  return {
    route,
    ...buildPublicReadinessEnvelope({
      ok: false,
      blockers: [],
      warnings: [],
      requiredDocumentsTotal: 1,
      generatedDocumentsTotal: 0,
      exportReadyDocumentsTotal: 0,
      ...overrides,
    }),
  };
}

function ready(route: string, counts = { requiredDocumentsTotal: 1, generatedDocumentsTotal: 1, exportReadyDocumentsTotal: 1 }): PublicReadinessEnvelope & { route: string } {
  return { route, ...buildPublicReadinessEnvelope({ ok: true, blockers: [], warnings: [], ...counts }) };
}

function assertPayloadContract(payload: PublicReadinessEnvelope & { route?: string }) {
  assert.equal(typeof payload.ok, "boolean", `${payload.route ?? "payload"} exposes ok`);
  assert.match(payload.status, /^(READY|BLOCKED|PARTIAL)$/);
  assert.ok(Array.isArray(payload.blockers), `${payload.route ?? "payload"} exposes blockers[]`);
  assert.ok(Array.isArray(payload.warnings), `${payload.route ?? "payload"} exposes warnings[]`);
  assert.equal(typeof payload.primaryBlockerReason === "string" || payload.primaryBlockerReason === null, true);
  assert.equal(typeof payload.primaryFixAction === "string" || payload.primaryFixAction === null, true);
  assert.equal(typeof payload.requiredDocumentsTotal, "number");
  assert.equal(typeof payload.generatedDocumentsTotal, "number");
  assert.equal(typeof payload.exportReadyDocumentsTotal, "number");
  assert.ok(payload.exportReadyDocumentsTotal <= payload.generatedDocumentsTotal, `${payload.route ?? "payload"} cannot have more export-ready docs than generated docs`);
  assert.doesNotMatch(JSON.stringify(payload), USER_FACING_METADATA_TERMS, `${payload.route ?? "payload"} must not expose user-facing metadata/server terminology`);
}

function assertBlockedRoutes(payloads: Array<PublicReadinessEnvelope & { route: string }>) {
  for (const payload of payloads) {
    assertPayloadContract(payload);
    assert.equal(payload.ok, false, `${payload.route} must be blocked`);
    assert.notEqual(payload.status, "READY", `${payload.route} must not say READY`);
    assert.ok(payload.primaryBlockerReason, `${payload.route} must expose primaryBlockerReason`);
    assert.ok(payload.primaryFixAction, `${payload.route} must expose primaryFixAction`);
    assert.doesNotMatch(JSON.stringify(payload), /ready to generate full proposal/i, `${payload.route} must not claim ready-to-generate`);
  }
  const agreement = assertPublicReadinessAgreement(payloads);
  assert.deepEqual(agreement.contradictions, []);
}

describe("route-driven workflow truth verification", () => {
  it("panel-facing routes use the shared public readiness envelope and do not expose raw server errors", () => {
    for (const file of PANEL_ROUTE_FILES) {
      const source = read(file);
      assert.match(source, /buildPublicReadinessEnvelope/, `${file} must use the shared route envelope`);
      assert.match(source, /ok:/, `${file} must expose ok`);
      assert.match(source, /blockers/, `${file} must expose blockers[]`);
      assert.match(source, /warnings/, `${file} must expose warnings[]`);
      assert.match(source, /requiredDocumentsTotal/, `${file} must expose requiredDocumentsTotal`);
      assert.match(source, /generatedDocumentsTotal/, `${file} must expose generatedDocumentsTotal`);
      assert.match(source, /exportReadyDocumentsTotal/, `${file} must expose exportReadyDocumentsTotal`);
      assert.doesNotMatch(source, /return\s+NextResponse\.json\([^)]*error\.message/s, `${file} must not return raw error.message`);
      const publicStringLiterals = [...source.matchAll(/NextResponse\.json\(([^;]+)/gs)].map((match) => match[1]).join("\n");
      assert.doesNotMatch(publicStringLiterals, SERVER_ERROR_TERMS, `${file} must not embed server error terminology in public payload text`);
    }
  });

  it("count-bearing routes use either the direct package model or an approved canonical resolver", () => {
    for (const file of DIRECT_PACKAGE_ROUTES) {
      const source = read(file);
      assert.match(source, /getFinalPackageReadinessModel/, `${file} must use final-package readiness directly`);
      assert.match(source, /finalPackage\.documents\.required\.length/, `${file} required total must be canonical`);
      assert.match(source, /finalPackage\.documents\.generated\.length/, `${file} generated total must be canonical`);
      assert.match(source, /finalPackage\.documents\.exportReady\.length/, `${file} export-ready total must be canonical`);
    }
    for (const [file, resolver] of Object.entries(DELEGATED_AUTHORITY_ROUTES)) {
      assert.match(read(file), resolver, `${file} must delegate to its approved canonical authority`);
    }
  });

  it("generation-readiness uses confirmed Build Plan authority and canonical final-package counts", () => {
    const source = read("app/api/tenders/[id]/generation-readiness/route.ts");
    assert.match(source, /getFinalPackageReadinessModel/);
    assert.match(source, /submissionPlanBuilt = finalPackage\.buildPlan\.confirmed/);
    assert.match(source, /requiredDocumentsTotal = finalPackage\.documents\.required\.length/);
    assert.doesNotMatch(source, /safeParseJsonArray|exactFileNaming|exactFileOrder/);
  });

  it("final-package readiness requires a current confirmed Build Plan", () => {
    const source = read("lib/engine/final-package-readiness-model.ts");
    assert.match(source, /parseConfirmedBuildPlan/);
    assert.match(source, /row\.confirmedRevision !== row\.revision/);
    assert.match(source, /row\.confirmedContentHash !== row\.contentHash/);
    assert.match(source, /code: "NO_CONFIRMED_BUILD_PLAN"/);
    assert.match(source, /ready: buildPlanAuthority\.confirmed && documentManifest\.ready/);
    assert.match(source, /source: buildPlanAuthority\.confirmed \? "CONFIRMED" : "DERIVED_FALLBACK"/);
  });

  it("authority review and validation consume canonical package blockers", () => {
    for (const file of [
      "app/api/tenders/[id]/authority-review/route.ts",
      "app/api/tenders/[id]/validate/route.ts",
    ]) {
      const source = read(file);
      assert.match(source, /getFinalPackageReadinessModel/);
      assert.match(source, /buildPublicReadinessEnvelope/);
      assert.match(source, /finalPackage\.documents\.blockers/);
      assert.match(source, /finalPackage\.export\.blockers/);
      assert.match(source, /finalPackage\.documents\.required\.length/);
      assert.match(source, /finalPackage\.documents\.exportReady\.length/);
    }
    const authority = read("app/api/tenders/[id]/authority-review/route.ts");
    assert.doesNotMatch(authority, /safeParseJsonArray|exactFileNaming|exactFileOrder/);
  });

  it("public blocker normalization whitelists fields and drops internal details", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: false,
      blockers: [{
        code: "SAFE_CODE",
        message: "Safe message",
        nextAction: "SAFE_ACTION",
        detail: "PrismaClientKnownRequestError: secret database detail",
        stack: "private stack",
      }],
    });
    assert.deepEqual(envelope.blockers[0], {
      code: "SAFE_CODE",
      message: "Safe message",
      nextAction: "SAFE_ACTION",
      severity: null,
    });
    assert.doesNotMatch(JSON.stringify(envelope), /Prisma|private stack|secret database detail/);
  });

  it("public blocker messages sanitize raw server errors and user-facing metadata terminology", () => {
    const rawError = buildPublicReadinessEnvelope({
      ok: false,
      blockers: ["PrismaClientKnownRequestError P2021: DATABASE_URL failed"],
    });
    assert.equal(rawError.blockers[0]?.message, "Readiness check could not be completed safely.");

    const wording = buildPublicReadinessEnvelope({
      ok: false,
      blockers: [{ message: "Critical metadata is incomplete.", nextAction: "REVIEW_TENDER_DETAILS" }],
    });
    assert.equal(wording.blockers[0]?.message, "Critical tender details are incomplete.");
    assert.doesNotMatch(JSON.stringify(wording), /metadata/i);
  });

  it("impossible document counts become a production blocker", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: true,
      requiredDocumentsTotal: 1,
      generatedDocumentsTotal: 0,
      exportReadyDocumentsTotal: 2,
    });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.status, "BLOCKED");
    assert.ok(envelope.blockers.some((blocker) => blocker.code === "READINESS_COUNT_CONTRADICTION"));
  });

  it("explicit READY cannot override false ok or blockers", () => {
    const falseOk = buildPublicReadinessEnvelope({ ok: false, status: "READY" });
    assert.equal(falseOk.ok, false);
    assert.equal(falseOk.status, "BLOCKED");

    const blockedPayload = buildPublicReadinessEnvelope({
      ok: true,
      status: "READY",
      blockers: [{ message: "Still blocked", nextAction: "FIX" }],
    });
    assert.equal(blockedPayload.ok, false);
    assert.equal(blockedPayload.status, "BLOCKED");
  });

  it("shared envelope treats explicit PARTIAL status as not ok", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: true,
      status: "PARTIAL",
      blockers: [],
      warnings: [{ message: "Review still required.", nextAction: "REVIEW_ANALYSIS" }],
      requiredDocumentsTotal: 1,
      generatedDocumentsTotal: 1,
      exportReadyDocumentsTotal: 0,
    });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.status, "PARTIAL");
  });

  it("shared envelope fails closed when blockers exist", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: true,
      blockers: [{ code: "NO_CONFIRMED_BUILD_PLAN", message: "No confirmed Build Plan.", nextAction: "BUILD_SUBMISSION_PLAN" }],
      requiredDocumentsTotal: 2,
      generatedDocumentsTotal: 0,
      exportReadyDocumentsTotal: 0,
    });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.status, "BLOCKED");
    assert.equal(envelope.primaryBlockerReason, "No confirmed Build Plan.");
    assert.equal(envelope.primaryFixAction, "BUILD_SUBMISSION_PLAN");
  });

  it("Scenario 1: partial AI Analyze blocks generation/export and no public payload says ready", () => {
    const payloads = [
      blocked("lifecycle", { blockers: [{ code: "PARTIAL_AI_ANALYSIS_BLOCKED", message: "AI Analyze is partial and must be resumed.", nextAction: "RESUME_AI_ANALYZE" }] }),
      blocked("generation-readiness", { blockers: [{ code: "FULL_PROPOSAL_NOT_ANALYZED", message: "Resume or retry AI Analyze before generation.", nextAction: "RETRY_AI_ANALYZE" }] }),
      blocked("export-readiness", { blockers: [{ code: "ANALYSIS_NOT_READY", message: "Export is blocked until AI Analyze succeeds.", nextAction: "RETRY_AI_ANALYZE" }] }),
      blocked("readiness-score", { blockers: [{ message: "AI Analyze is not complete.", nextAction: "RETRY_AI_ANALYZE" }] }),
      blocked("workflow-status", { blockers: ["AI Analyze is partial."], primaryFixAction: "RETRY_AI_ANALYZE" }),
      blocked("tender-detail", { blockers: [{ message: "0/1 required documents are export-ready.", nextAction: "Open export readiness." }] }),
    ];
    assertBlockedRoutes(payloads);
    assert.match(JSON.stringify(payloads), /RESUME_AI_ANALYZE|RETRY_AI_ANALYZE/);
  });

  it("Scenario 2: no confirmed Build Plan is the primary blocker", () => {
    const payloads = ["lifecycle", "generation-readiness", "readiness-score", "export-readiness", "workflow-status", "tender-detail"].map((route) => blocked(route, {
      blockers: [{ code: "NO_CONFIRMED_BUILD_PLAN", message: "No confirmed Build Plan.", nextAction: "BUILD_SUBMISSION_PLAN" }],
      requiredDocumentsTotal: 1,
    }));
    assertBlockedRoutes(payloads);
    assert.ok(payloads.every((payload) => payload.primaryBlockerReason === "No confirmed Build Plan."));
  });

  it("Scenario 3: planned docs without content never become 0/0", () => {
    const payloads = ["readiness-score", "generation-readiness", "export-readiness", "workflow-status", "tender-detail"].map((route) => blocked(route, {
      blockers: [{ code: "PLANNED_DOCUMENTS_NOT_GENERATED", message: "Required documents are planned but not generated.", nextAction: "GENERATE_REQUIRED_DOCUMENTS" }],
      requiredDocumentsTotal: 3,
      generatedDocumentsTotal: 0,
      exportReadyDocumentsTotal: 0,
    }));
    assertBlockedRoutes(payloads);
    for (const payload of payloads) {
      assert.equal(payload.requiredDocumentsTotal > 0, true);
      assert.notEqual(`${payload.exportReadyDocumentsTotal}/${payload.requiredDocumentsTotal}`, "0/0");
    }
  });

  it("Scenario 4: a required PDF remains blocked across review, validation, and export", () => {
    const payloads = [
      blocked("authority-review", { blockers: [{ code: "PDF_REQUIRED_NOT_READY", message: "Technical Proposal.pdf is required.", nextAction: "UPLOAD_FINAL_PDF" }] }),
      blocked("validate", { blockers: [{ code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE", message: "Required PDF is unavailable.", nextAction: "UPLOAD_FINAL_PDF" }] }),
      blocked("export-readiness", { blockers: [{ code: "FINAL_ZIP_FILE_NOT_READY", message: "Technical Proposal.pdf is not export-ready.", nextAction: "UPLOAD_FINAL_PDF" }] }),
    ];
    assertBlockedRoutes(payloads);
  });

  it("Scenario 5: all routes agree when canonical counts and blockers are ready", () => {
    const payloads = ["lifecycle", "generation-readiness", "readiness-score", "export-readiness", "workflow-status", "tender-detail"].map((route) => ready(route));
    for (const payload of payloads) assertPayloadContract(payload);
    const agreement = assertPublicReadinessAgreement(payloads);
    assert.deepEqual(agreement.contradictions, []);
  });
});
