import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isCurrentRecordStatus } from "../lib/engine/generate-elite";

/**
 * A.3 of run 36074770709 listed the firm's registrations as
 * "Business Licence (licence) — Ministry of Trade [ACTIVE]": the record's
 * database status, printed as a bracketed tag. A record status is a filter,
 * not client text — a record the firm does not currently hold is not listed,
 * and a current one is listed without the tag.
 */

describe("a record's status filters A.3; it is not printed", () => {
  it("treats active, valid, current, verified, in-force and unrecorded as current", () => {
    for (const status of ["ACTIVE", "active", "Valid", "CURRENT", "verified", "In Force", "", null, undefined]) {
      assert.equal(isCurrentRecordStatus(status), true, String(status));
    }
  });

  it("does not list an expired, revoked, pending or suspended record", () => {
    for (const status of ["EXPIRED", "revoked", "PENDING", "suspended", "superseded"]) {
      assert.equal(isCurrentRecordStatus(status), false, status);
    }
  });

  it("A.3 prints no bracketed status", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const a3 = source.slice(source.indexOf('"## A.3 Evidence of Compliance"'), source.indexOf('"## A.4 Key Personnel"'));
    assert.ok(a3.length > 100);
    assert.doesNotMatch(a3, /\[\$\{r\.status\}\]|\$\{r\.status\s*\?/);
    assert.match(a3, /legalRecs\.filter\(\(r\) => isCurrentRecordStatus\(r\.status\)\)/);
    assert.match(a3, /complianceRecs\.filter\(\(r\) => isCurrentRecordStatus\(r\.status\)\)/);
  });
});
