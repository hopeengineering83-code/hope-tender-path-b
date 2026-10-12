import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const submissionPlan = readFileSync(join(rootDir, "app/api/tenders/[id]/submission-plan/route.ts"), "utf8");
const advisory = readFileSync(join(rootDir, "app/api/tenders/[id]/advisory-resolutions/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

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
    // Owner scoping moved into the shared loader when this route and the
    // automatic finalize pipeline were collapsed onto one completeness
    // authority. Tenant isolation is the guarantee, so assert both halves:
    // the route must pass the acting user down, and the loader must scope
    // every read by it — including the confirmed-plan lookup.
    assert.match(submissionPlan, /loadSubmissionPlanCompleteness\(prisma, id, actor\.id\)/);
    const loader = readFileSync(join(rootDir, "lib/engine/submission-plan-completeness.ts"), "utf8");
    assert.match(loader, /where: \{ id: tenderId, userId \}/);
    assert.match(loader, /getCurrentConfirmedBuildPlan\(client, tenderId, userId\)/);
    assert.match(loader, /generatedDocuments: tender\.generatedDocuments\.map/);
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

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
