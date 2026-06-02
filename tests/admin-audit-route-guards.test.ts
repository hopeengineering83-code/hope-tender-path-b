// Verifies the admin generated-proposal audit endpoint's contract via
// source inspection. The end-to-end behaviour (auth handling, DB queries,
// response shape) is exercised at the Vercel preview layer; this file
// pins the safety guarantees that must never regress:
//
//   1. Route requires ADMIN role.
//   2. Route never spreads `fileContent` into the response.
//   3. Route never echoes proposal body text (no fullText/proposalText/
//      extractedBody fields in the response shape).
//   4. Route uses the canonical exclusion helper isFinalExportCandidateDocument.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROUTE_SOURCE = readFileSync("app/api/admin/generated-proposals/audit/route.ts", "utf8");

describe("admin generated-proposals audit — safety contract", () => {
  it("requires ADMIN role only", () => {
    assert.match(ROUTE_SOURCE, /requireRole\(\s*"ADMIN"\s*\)/, "audit route must require ADMIN role");
  });
  it("never spreads fileContent into a response row", () => {
    assert.ok(
      !/fileContent\s*:\s*d\.fileContent/.test(ROUTE_SOURCE),
      "audit response must not echo fileContent",
    );
    // Also check the AuditRow type does not declare fileContent as a public field.
    assert.ok(!/^\s*fileContent\??:\s*string/m.test(ROUTE_SOURCE), "AuditRow type must not expose fileContent");
  });
  it("never returns proposal body text under any obvious field name", () => {
    assert.ok(!/proposalText|fullText|extractedBody|bodyText/.test(ROUTE_SOURCE), "audit response must not include proposal body text");
  });
  it("uses the canonical isFinalExportCandidateDocument helper for exclusion", () => {
    assert.match(ROUTE_SOURCE, /isFinalExportCandidateDocument/, "audit must use the canonical final-export-candidate helper, not its own ad-hoc filter");
  });
  it("supports the spec-required query params (tenderId / limit / includeReady / severity)", () => {
    for (const param of ["tenderId", "limit", "includeReady", "severity"]) {
      assert.match(ROUTE_SOURCE, new RegExp(`searchParams\\.get\\(["']${param}["']\\)`), `query param ${param} should be honoured`);
    }
  });
  it("returns aggregate summary counts (no per-tender body leakage in summary)", () => {
    for (const field of [
      "totalGeneratedDocuments",
      "finalExportCandidates",
      "readyForExport",
      "blockedDocuments",
      "missingContent",
      "invalidSignatures",
      "aiTraceIssues",
      "placeholderIssues",
      "pricingLeakageIssues",
      "officialOriginalRisks",
      "staleInternalRows",
    ]) {
      assert.match(ROUTE_SOURCE, new RegExp(field), `summary must include ${field}`);
    }
  });
  it("clamps limit to a safe range (1..200)", () => {
    assert.match(ROUTE_SOURCE, /Math\.min\(\s*200\s*,/, "limit must be capped at 200");
  });
});
