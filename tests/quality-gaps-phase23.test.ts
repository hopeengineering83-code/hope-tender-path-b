// Regression tests for quality gap fixes — Phase 23.
//
// Phase 23 covers one targeted hardening improvement:
//
//   Submission-address criticality escalation:
//     submissionAddress is now CRITICAL (not non-critical) when the tender's
//     submissionMethod indicates physical / sealed delivery (sealed envelope,
//     hard copy, hand delivery, courier, registered mail, drop-off, post, by hand,
//     in person, physical delivery). Without a verified delivery address, the
//     bidder cannot physically submit the package.
//
//   For email / portal methods, submissionAddress remains a non-critical warning.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { assessTenderMetadataCompleteness, isPhysicalSubmissionMethod } from "../lib/engine/tender-metadata-completeness";

// ── isPhysicalSubmissionMethod helper ─────────────────────────────────────────

describe("phase 23 — isPhysicalSubmissionMethod detection", () => {
  const physicalMethods = [
    "Sealed envelope",
    "sealed envelope submission",
    "Hard copy only",
    "Physical delivery to procurement office",
    "Hand deliver to the office",
    "hand delivery",
    "Drop off at tender box",
    "drop-off",
    "Courier delivery",
    "Registered mail",
    "Post to the address below",
    "By hand",
    "In person",
  ];
  for (const method of physicalMethods) {
    it(`detects "${method}" as physical`, () => {
      assert.equal(isPhysicalSubmissionMethod(method), true, `"${method}" must be detected as a physical method`);
    });
  }

  const nonPhysicalMethods = [
    "Email submission",
    "Online portal",
    "Upload via tender portal",
    "Electronic submission",
    "Email to procurement@example.com",
    null,
    "",
    undefined,
  ];
  for (const method of nonPhysicalMethods) {
    it(`does not flag "${method}" as physical`, () => {
      assert.equal(isPhysicalSubmissionMethod(method as string | null | undefined), false, `"${method}" must not be detected as physical`);
    });
  }
});

// ── submissionAddress critical escalation ─────────────────────────────────────

describe("phase 23 — submissionAddress becomes CRITICAL for physical methods", () => {
  it("missing submissionAddress blocks generation when method is Sealed envelope", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Road Construction RFP",
      clientName: "Ministry of Works",
      submissionMethod: "Sealed envelope",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingCritical.some((f) => f.field === "submissionAddress");
    assert.ok(found, "submissionAddress must appear in missingCritical when method is sealed envelope and address is missing");
    assert.equal(result.blockingForGeneration, true, "missing submissionAddress on sealed-envelope tender must block generation");
  });

  it("missing submissionAddress blocks generation when method is Hard copy", () => {
    const result = assessTenderMetadataCompleteness({
      title: "IT Procurement",
      clientName: "ICT Authority",
      submissionMethod: "Hard copy only",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingCritical.some((f) => f.field === "submissionAddress");
    assert.ok(found, "submissionAddress must appear in missingCritical for hard copy method");
  });

  it("provided submissionAddress does not block generation on sealed envelope method", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Road Construction RFP",
      clientName: "Ministry of Works",
      submissionMethod: "Sealed envelope",
      submissionAddress: "Procurement Office, Room 204, Ministry HQ, Nairobi",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingCritical.some((f) => f.field === "submissionAddress");
    assert.ok(!found, "provided submissionAddress must not appear in missingCritical");
  });

  it("missing submissionAddress is only a WARNING (not critical) for email method", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Consultancy RFP",
      clientName: "World Bank",
      submissionMethod: "Email submission",
      submissionEmails: "tenders@worldbank.org",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const inCritical = result.missingCritical.some((f) => f.field === "submissionAddress");
    const inNonCritical = result.missingNonCritical.some((f) => f.field === "submissionAddress");
    assert.ok(!inCritical, "submissionAddress must not be critical for email methods");
    assert.ok(inNonCritical, "submissionAddress must appear in non-critical warnings for email methods");
  });

  it("missing submissionAddress is only a WARNING for portal method", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Portal Tender",
      clientName: "Government Agency",
      submissionMethod: "Online portal submission",
      submissionEmails: "portal@gov.example",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const inCritical = result.missingCritical.some((f) => f.field === "submissionAddress");
    assert.ok(!inCritical, "submissionAddress must not be critical for portal methods");
  });

  it("submissionAddress is in CriticalMetadataField type (static audit)", () => {
    const src = readFileSync("lib/engine/tender-metadata-completeness.ts", "utf8");
    assert.ok(
      src.includes('"submissionAddress"') && src.includes("CriticalMetadataField"),
      "submissionAddress must be added to CriticalMetadataField union type",
    );
    assert.ok(
      src.includes("isPhysicalSubmissionMethod"),
      "isPhysicalSubmissionMethod helper must be exported",
    );
  });
});

// ── Regression: existing completeness checks unchanged ────────────────────────

describe("phase 23 — regression: existing metadata completeness checks unchanged", () => {
  it("submissionEndpoint still blocks when both email and address are missing", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test",
      clientName: "Client",
      submissionMethod: "Email",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingCritical.some((f) => f.field === "submissionEndpoint" || f.field === "submissionAddress");
    assert.ok(found, "missing submission endpoint must still block");
  });

  it("hasAnyEndpoint passes when submissionAddress is set (non-physical method)", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test",
      clientName: "Client",
      submissionMethod: "Email",
      submissionAddress: "P.O. Box 100",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const endpointMissing = result.missingCritical.some((f) => f.field === "submissionEndpoint");
    assert.ok(!endpointMissing, "submissionEndpoint must not block when address is set");
  });
});
