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
  it("panel-facing routes all use the shared public readiness envelope and do not expose raw server errors", () => {
    for (const file of PANEL_ROUTE_FILES) {
      const source = read(file);
      assert.match(source, /buildPublicReadinessEnvelope/, `${file} must use the shared route envelope`);
      assert.match(source, /ok:/, `${file} must expose ok`);
      assert.match(source, /blockers/, `${file} must expose blockers[]`);
      assert.match(source, /warnings/, `${file} must expose warnings[]`);
      // primaryBlockerReason/primaryFixAction are supplied by the shared envelope,
      // so routes must either mention them directly or delegate to the helper.
      assert.match(source, /primaryBlockerReason|buildPublicReadinessEnvelope/, `${file} must expose primaryBlockerReason`);
      assert.match(source, /primaryFixAction|buildPublicReadinessEnvelope/, `${file} must expose primaryFixAction`);
      assert.match(source, /requiredDocumentsTotal/, `${file} must expose requiredDocumentsTotal`);
      assert.match(source, /generatedDocumentsTotal/, `${file} must expose generatedDocumentsTotal`);
      assert.match(source, /exportReadyDocumentsTotal/, `${file} must expose exportReadyDocumentsTotal`);
      assert.doesNotMatch(source, /return\s+NextResponse\.json\([^)]*error\.message/s, `${file} must not return raw error.message`);
      const publicStringLiterals = [...source.matchAll(/NextResponse\.json\(([^;]+)/gs)].map((m) => m[1]).join("\n");
      assert.doesNotMatch(publicStringLiterals, SERVER_ERROR_TERMS, `${file} must not embed server error terminology in public payload text`);
    }
  });

  it("shared envelope fails closed: ok cannot stay true when blockers exist", () => {
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

  it("Scenario 2: no confirmed Build Plan is the primary blocker and no route says ready to generate full proposal", () => {
    const payloads = ["lifecycle", "generation-readiness", "readiness-score", "export-readiness", "workflow-status", "tender-detail"].map((route) => blocked(route, {
      blockers: [{ code: "NO_CONFIRMED_BUILD_PLAN", message: "No confirmed Build Plan.", nextAction: "BUILD_SUBMISSION_PLAN" }],
      requiredDocumentsTotal: 1,
    }));
    assertBlockedRoutes(payloads);
    assert.ok(payloads.every((payload) => payload.primaryBlockerReason === "No confirmed Build Plan."));
  });

  it("Scenario 3: planned docs without content have required total > 0, generated = 0, export-ready = 0, never 0/0", () => {
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

  it("Scenario 4: missing Technical Proposal.pdf stays structured across authority/review, validation, and export readiness", () => {
    const payloads = [
      blocked("authority-review", { blockers: [{ code: "MISSING_REQUIRED_DOCUMENT", message: "Technical Proposal.pdf is missing.", nextAction: "UPLOAD_OR_GENERATE_TECHNICAL_PROPOSAL_PDF" }] }),
      blocked("document-validation", { blockers: [{ code: "DOCUMENT_VALIDATION_BLOCKED", message: "Technical Proposal.pdf is required before validation can pass.", nextAction: "UPLOAD_OR_GENERATE_TECHNICAL_PROPOSAL_PDF" }] }),
      blocked("export-readiness", { blockers: [{ code: "MISSING_REQUIRED_DOCUMENT", message: "Technical Proposal.pdf is missing.", nextAction: "UPLOAD_OR_GENERATE_TECHNICAL_PROPOSAL_PDF" }] }),
    ];
    assertBlockedRoutes(payloads);
    assert.match(JSON.stringify(payloads), /Technical Proposal\.pdf/);
  });

  it("Scenario 5: final export only unlocks when generated, validated, approved, and required counts agree", () => {
    const before = blocked("export-readiness", {
      blockers: [{ code: "REVIEW_REQUIRED", message: "Generated document needs validation and approval.", nextAction: "VALIDATE_AND_APPROVE" }],
      requiredDocumentsTotal: 1,
      generatedDocumentsTotal: 1,
      exportReadyDocumentsTotal: 0,
    });
    assertBlockedRoutes([before]);

    const afterRoutes = ["lifecycle", "generation-readiness", "readiness-score", "export-readiness", "workflow-status", "tender-detail"].map((route) => ready(route));
    for (const payload of afterRoutes) assertPayloadContract(payload);
    assert.deepEqual(assertPublicReadinessAgreement(afterRoutes).contradictions, []);
    assert.ok(afterRoutes.every((payload) => payload.ok && payload.status === "READY"));
  });
});
