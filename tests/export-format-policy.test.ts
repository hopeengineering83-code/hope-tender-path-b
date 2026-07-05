// Tests for lib/engine/export-format-policy.ts —
// PDF-required format coverage + branding/signature/stamp policy.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  checkTenderFormatCoverage,
  detectBrandingPolicy,
  detectTenderFormatPolicy,
  resolveExportAssetStatus,
  validateFileSignature,
} from "../lib/engine/export-format-policy";

// ─── Tiny binary fixtures (base64-encoded) ─────────────────────────────

// "PK" + 8 padding bytes — a valid DOCX/ZIP signature start.
const DOCX_SIG_B64 = Buffer.concat([Buffer.from([0x50, 0x4b]), Buffer.alloc(8)]).toString("base64");
// "%PDF" + version bytes — a valid PDF signature start.
const PDF_SIG_B64 = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(4)]).toString("base64");

describe("detectTenderFormatPolicy", () => {
  it("returns empty when tender has no exact filenames declared", () => {
    const policy = detectTenderFormatPolicy({});
    assert.equal(policy.requiresPdf, false);
    assert.equal(policy.requiresDocx, false);
    assert.deepEqual(policy.requiredFormats, []);
    assert.deepEqual(policy.perFile, []);
  });

  it("detects PDF-only requirement", () => {
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical-Proposal.pdf"]),
    });
    assert.equal(policy.requiresPdf, true);
    assert.equal(policy.requiresDocx, false);
    assert.deepEqual(policy.requiredFormats, ["pdf"]);
  });

  it("detects DOCX-only requirement", () => {
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx"]),
    });
    assert.equal(policy.requiresPdf, false);
    assert.equal(policy.requiresDocx, true);
  });

  it("detects mixed PDF + DOCX requirement", () => {
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Financial-Offer.pdf"]),
    });
    assert.equal(policy.requiresPdf, true);
    assert.equal(policy.requiresDocx, true);
    assert.deepEqual(policy.requiredFormats.sort(), ["docx", "pdf"]);
    assert.equal(policy.perFile.length, 2);
  });

  it("pulls per-requirement exactFileName too", () => {
    const policy = detectTenderFormatPolicy({
      requirements: [{ exactFileName: "Compliance-Matrix.pdf" }],
    });
    assert.equal(policy.requiresPdf, true);
  });

  it("ignores filenames with unsupported extensions", () => {
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "README.md"]),
    });
    assert.equal(policy.requiresDocx, true);
    assert.equal(policy.requiresPdf, false);
    assert.equal(policy.perFile.length, 1);
  });
});

describe("validateFileSignature", () => {
  it("accepts a DOCX with PK signature under a .docx extension", () => {
    const result = validateFileSignature("Technical-Proposal.docx", DOCX_SIG_B64);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.detected, "docx");
  });

  it("accepts a PDF with %PDF signature under a .pdf extension", () => {
    const result = validateFileSignature("Financial-Offer.pdf", PDF_SIG_B64);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.detected, "pdf");
  });

  it("rejects a PDF binary renamed to .docx (PK signature missing)", () => {
    const result = validateFileSignature("Renamed.docx", PDF_SIG_B64);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not a valid DOC\/DOCX/i);
  });

  it("rejects a DOCX binary renamed to .pdf (%PDF signature missing)", () => {
    const result = validateFileSignature("Renamed.pdf", DOCX_SIG_B64);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not a valid PDF/i);
  });

  it("rejects unsupported extensions", () => {
    const result = validateFileSignature("garbage.xyz", DOCX_SIG_B64);
    assert.equal(result.ok, false);
  });

  it("rejects empty / undersized content", () => {
    const result = validateFileSignature("Empty.docx", Buffer.from([0x50]).toString("base64"));
    assert.equal(result.ok, false);
  });
});

describe("checkTenderFormatCoverage", () => {
  it("passes when tender requires PDF and a PDF is generated", () => {
    const policy = detectTenderFormatPolicy({ exactFileNaming: JSON.stringify(["Technical-Proposal.pdf"]) });
    const result = checkTenderFormatCoverage(policy, ["pdf"]);
    assert.equal(result.ok, true);
  });

  it("BLOCKS with PDF_REQUIRED_CONVERSION_UNAVAILABLE when tender requires PDF and only DOCX exists", () => {
    const policy = detectTenderFormatPolicy({ exactFileNaming: JSON.stringify(["Technical-Proposal.pdf"]) });
    const result = checkTenderFormatCoverage(policy, ["docx"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE");
      assert.match(result.reason, /PDF conversion is not currently available/i);
      assert.deepEqual(result.missing, ["Technical-Proposal.pdf"]);
    }
  });

  it("passes when tender requires both DOCX and PDF and both are generated", () => {
    const policy = detectTenderFormatPolicy({ exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Financial-Offer.pdf"]) });
    const result = checkTenderFormatCoverage(policy, ["docx", "pdf"]);
    assert.equal(result.ok, true);
  });

  it("BLOCKS when tender requires DOCX+PDF but only DOCX is generated", () => {
    const policy = detectTenderFormatPolicy({ exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Financial-Offer.pdf"]) });
    const result = checkTenderFormatCoverage(policy, ["docx"]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE");
  });

  it("passes when tender has no explicit format requirement", () => {
    const policy = detectTenderFormatPolicy({});
    const result = checkTenderFormatCoverage(policy, ["docx"]);
    assert.equal(result.ok, true);
  });
});

describe("detectBrandingPolicy", () => {
  it("allows everything by default (no restriction language)", () => {
    const policy = detectBrandingPolicy("Standard tender requesting technical and financial proposals.");
    assert.equal(policy.brandingAllowed, true);
    assert.equal(policy.signatureAllowed, true);
    assert.equal(policy.stampAllowed, true);
    assert.equal(policy.blockers.length, 0);
  });

  it("blocks branding when tender says 'no logo' or 'no letterhead'", () => {
    const policy = detectBrandingPolicy("The submission must not contain any logo or company branding.");
    assert.equal(policy.brandingAllowed, false);
    assert.ok(policy.blockers.some((b) => b.kind === "branding"));
  });

  it("blocks branding when tender requires standardised template untouched", () => {
    const policy = detectBrandingPolicy("Template must not be modified — use the format provided.");
    assert.equal(policy.brandingAllowed, false);
  });

  it("blocks signatures when tender says 'unsigned submissions only'", () => {
    const policy = detectBrandingPolicy("All submissions must be unsigned. Hand-written signatures are not permitted.");
    assert.equal(policy.signatureAllowed, false);
    assert.ok(policy.blockers.some((b) => b.kind === "signature"));
  });

  it("blocks stamps when tender prohibits company stamps", () => {
    const policy = detectBrandingPolicy("No stamps or seals shall appear on submitted documents.");
    assert.equal(policy.stampAllowed, false);
    assert.ok(policy.blockers.some((b) => b.kind === "stamp"));
  });

  it("blocks ALL THREE assets when anonymous submission is required", () => {
    const policy = detectBrandingPolicy("Submissions will undergo anonymous review. Bidder identity must be masked.");
    assert.equal(policy.brandingAllowed, false);
    assert.equal(policy.signatureAllowed, false);
    assert.equal(policy.stampAllowed, false);
    assert.ok(policy.blockers.some((b) => b.kind === "anonymous"));
  });

  it("blocks ALL THREE under double-blind review wording", () => {
    const policy = detectBrandingPolicy("This bid will be subject to double-blind evaluation.");
    assert.equal(policy.brandingAllowed, false);
    assert.equal(policy.signatureAllowed, false);
    assert.equal(policy.stampAllowed, false);
  });
});

describe("resolveExportAssetStatus", () => {
  it("combines tender policy with AppSettings; tender wins when there's conflict", () => {
    const tenderPolicy = detectBrandingPolicy("No branding or logos permitted on submissions.");
    const status = resolveExportAssetStatus(tenderPolicy, {
      allowBrandingDefault: true,
      allowSignatureDefault: true,
      allowStampDefault: true,
    });
    // Branding is prohibited by the tender; firm's setting is ignored.
    assert.equal(status.brandingAllowed, false);
    assert.equal(status.brandingApplied, false);
    // Signature and stamp remain allowed.
    assert.equal(status.signatureAllowed, true);
    assert.equal(status.stampAllowed, true);
  });

  it("respects firm setting when tender does not restrict (settingOff → not applied even when allowed)", () => {
    const tenderPolicy = detectBrandingPolicy("Standard submission requirements.");
    const status = resolveExportAssetStatus(tenderPolicy, {
      allowBrandingDefault: false,
      allowSignatureDefault: false,
      allowStampDefault: false,
    });
    assert.equal(status.brandingAllowed, true, "tender does not restrict — allowed");
    assert.equal(status.brandingApplied, false, "firm setting is off — not applied");
    assert.equal(status.signatureAllowed, true);
    assert.equal(status.signatureApplied, false);
  });

  it("includes policyBlockers list for the UI", () => {
    const tenderPolicy = detectBrandingPolicy("Anonymous submission required.");
    const status = resolveExportAssetStatus(tenderPolicy, {});
    assert.ok(status.policyBlockers.length > 0);
    assert.equal(status.policyBlockers[0].kind, "anonymous");
  });
});
