import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

const getStart = source.indexOf("export async function GET");
const postStart = source.indexOf("export async function POST");
const getRegion = source.slice(getStart, postStart);
const postRegion = source.slice(postStart);

describe("company knowledge repair mutation RBAC", () => {
  it("keeps diagnostics GET available to authenticated readers", () => {
    assert.match(getRegion, /getSession\(\)/);
    assert.match(getRegion, /buildDiagnostics\(company\.id\)/);
    assert.doesNotMatch(getRegion, /importCompanyKnowledgeFromDocuments/);
  });

  it("requires ADMIN or PROPOSAL_MANAGER for POST", () => {
    assert.match(postRegion, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(postRegion, /forbiddenResponse\(\)/);
    assert.match(postRegion, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(postRegion, /getSession/);
    assert.doesNotMatch(postRegion, /"REVIEWER"|"VIEWER"/);
  });

  it("uses the role-approved actor for persistent throttling and company scope", () => {
    assert.match(postRegion, /rateLimitPersistent\(`knowledge-repair:\$\{actor\.id\}`/);
    assert.match(postRegion, /getCompany\(actor\.id\)/);
    assert.match(postRegion, /userId: actor\.id/);
  });

  it("preserves importer and diagnostic behavior", () => {
    assert.match(postRegion, /importCompanyKnowledgeFromDocuments\(company\.id\)/);
    assert.match(postRegion, /buildDiagnostics\(company\.id\)/);
    assert.match(postRegion, /expertsCreated/);
    assert.match(postRegion, /projectsCreated/);
    assert.match(postRegion, /aiFailures/);
  });

  it("returns stable correlated failures and makes audit non-fatal", () => {
    assert.match(postRegion, /COMPANY_KNOWLEDGE_REPAIR_FAILED/);
    assert.match(postRegion, /extractRequestId\(req\)/);
    assert.match(postRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(postRegion, /void logAction\(/);
    assert.match(postRegion, /company knowledge repair audit persistence failed/);
    assert.doesNotMatch(postRegion, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("returns requestId on the success response for request correlation", () => {
    // The success response must include requestId so operators can correlate
    // a successful operation with its audit log and request logs.
    // The success return is the one that contains both 'result' and 'diagnostics'.
    const lines = postRegion.split("\n");
    const successLine = lines.find((l) =>
      l.includes("return NextResponse.json(") &&
      l.includes("result:") &&
      l.includes("diagnostics")
    );
    assert.ok(successLine, "must have a success response returning result + diagnostics");
    assert.match(successLine!, /requestId/,
      "success response must include requestId for request correlation");
  });

  it("does not extract or audit a force parameter the importer does not accept", () => {
    // The importer signature is importCompanyKnowledgeFromDocuments(companyId).
    // There is no force parameter. Extracting force from the request body and
    // auditing it would mislead operators into thinking they can control
    // re-import behavior via the request body.
    assert.doesNotMatch(postRegion, /body\?\.force/,
      "must not extract force from request body — importer does not accept it");
    assert.doesNotMatch(postRegion, /force,/m,
      "must not audit a force flag that has no runtime effect");
    assert.doesNotMatch(postRegion, /await req\.json/,
      "must not parse the request body at all — POST takes no body parameters");
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
