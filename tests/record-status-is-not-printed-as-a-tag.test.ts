import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isCurrentRecordStatus } from "../lib/engine/record-status";
import { buildCertificationsSection } from "../lib/engine/understanding-and-value-added";

/**
 * Run 36074770709 printed each company record's database status as client
 * text: A.3 listed "Business Licence (licence) — Ministry of Trade [ACTIVE]",
 * and D.3 repeated the same records with an "ACTIVE" column. A record status
 * is a filter, not client text — a record the firm does not currently hold is
 * not listed, and a current one is listed without the tag. The records are
 * listed once, in D.3, where the tender asks for certifications.
 */

describe("a record's status filters the certifications; it is not printed", () => {
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

  it("D.3 lists current records with their reference and no status", () => {
    const section = buildCertificationsSection({
      experts: [],
      companyName: "Acme Consulting",
      legalRecords: [
        { title: "Business Licence", recordType: "BUSINESS_LICENSE", referenceNumber: "BL/123", status: "ACTIVE" },
        { title: "Old Trade Permit", recordType: "PERMIT", referenceNumber: "TP/9", status: "EXPIRED" },
      ],
      complianceRecords: [{ title: "Quality Management System Manual", complianceType: "QMS", referenceNumber: "QMS/034", status: "VERIFIED" }],
    });
    assert.match(section, /Business Licence/);
    assert.match(section, /BL\/123/);
    assert.match(section, /Quality Management System Manual/);
    assert.doesNotMatch(section, /Old Trade Permit/);
    assert.doesNotMatch(section, /\bACTIVE\b|\bVERIFIED\b|\| Status \|/);
  });

  it("the fallback prints no second copy of the records in Section A", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.doesNotMatch(source, /lines\.push\("## A\.3 Evidence of Compliance"\)/);
    assert.doesNotMatch(source, /\[\$\{r\.status\}\]/);
  });
});
