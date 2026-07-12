import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const submissionPlan = readFileSync("app/api/tenders/[id]/submission-plan/route.ts", "utf8");
const advisory = readFileSync("app/api/tenders/[id]/advisory-resolutions/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

function assertSafeRuntimeErrors(source: string, code: string) {
  assert.doesNotMatch(source, /sanitizeError/);
  assert.doesNotMatch(source, /detail:\s*(?:error|message|sanitizeError)/);
  assert.match(source, new RegExp(code));
  assert.match(source, /extractRequestId\(req\)/);
  assert.match(source, /requestId/);
  assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
}

describe("tender diagnostic routes keep runtime failures server-side", () => {
  it("protects submission-plan runtime errors without changing owner scoping", () => {
    assertSafeRuntimeErrors(submissionPlan, "SUBMISSION_PLAN_RUNTIME_ERROR");
    assert.match(submissionPlan, /where: \{ id, userId: actor\.id \}/);
    assert.match(submissionPlan, /getCurrentConfirmedBuildPlan\(prisma, id, actor\.id\)/);
    assert.match(submissionPlan, /generatedDocuments: tender\.generatedDocuments\.map/);
  });

  it("protects both advisory lookup and mutation runtime errors", () => {
    assertSafeRuntimeErrors(advisory, "ADVISORY_RESOLUTION_RUNTIME_ERROR");
    assert.match(advisory, /advisory-resolutions GET failed/);
    assert.match(advisory, /advisory-resolutions POST failed/);
    const ownerChecks = advisory.match(/where: \{ id, userId: actor\.id \}/g) ?? [];
    assert.equal(ownerChecks.length, 2);
  });

  it("preserves advisory validation and reopen semantics", () => {
    assert.match(advisory, /VALID_RESOLUTIONS/);
    assert.match(advisory, /INVALID_RESOLUTION/);
    assert.match(advisory, /resolution === "REOPEN"/);
    assert.match(advisory, /resolved: resolution !== "REOPEN"/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});
