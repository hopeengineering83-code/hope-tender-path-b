import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Tender delete lifecycle", () => {
  it("DELETE handler uses prisma.$transaction (not a bare delete)", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("prisma.$transaction(async (tx) => {"), "DELETE handler must use prisma.$transaction");
    assert.ok(!src.includes("await prisma.tender.delete({ where: { id } });"), "DELETE handler must NOT use a bare prisma.tender.delete");
  });

  it("DELETE handler deletes SubmissionPlanState explicitly", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("submissionPlanState.deleteMany"), "must explicitly delete SubmissionPlanState");
  });

  it("DELETE handler deletes generated documents and their children first", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("documentReview.deleteMany") || src.includes("DocumentReview.deleteMany"), "must delete document reviews first");
    assert.ok(src.includes("generatedDocument.deleteMany"), "must delete generated documents before the tender");
  });

  it("DELETE handler deletes AI job children first", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("aiAnalyzeChunk.deleteMany") || src.includes("aiJobStep.deleteMany"), "must delete AI job children first");
    assert.ok(src.includes("aiJob.deleteMany"), "must delete AI jobs before the tender");
  });

  it("DELETE handler deletes tender requirements, files, and other children", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("tenderRequirement.deleteMany"), "must delete tender requirements");
    assert.ok(src.includes("tenderFile.deleteMany"), "must delete tender files");
    assert.ok(src.includes("complianceGap.deleteMany"), "must delete compliance gaps");
  });

  it("DELETE handler uses Serializable isolation and explicit timeout", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes('isolationLevel: "Serializable"'), "must use Serializable isolation");
    assert.ok(src.includes("timeout:"), "must have an explicit timeout");
  });

  it("DELETE handler preserves authorization and audit logging", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("requireRole") && src.includes('"ADMIN", "PROPOSAL_MANAGER"'), "must require ADMIN or PROPOSAL_MANAGER");
    assert.ok(src.includes("logAction") && src.includes("TENDER_DELETE"), "must log the deletion action");
  });

  it("DELETE handler does not swallow errors silently", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes('status: 500'), "must return 500 on failure");
    assert.ok(src.includes("logger.error"), "must log errors");
  });
});
