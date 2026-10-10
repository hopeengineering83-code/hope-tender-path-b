import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { shouldScanForExperts, shouldScanForProjects } from "../lib/company-document-classifier";

describe("canonical Company Vault scan classification", () => {
  it("recognises the owner's plural CV filename", () => {
    assert.equal(shouldScanForExperts("detailed-cvs.txt", "AUTO", "Professional team register"), true);
  });

  it("recognises strong extracted-content indicators for auto-detected uploads", () => {
    assert.equal(shouldScanForExperts("upload.txt", "AUTO", "Proposed position: Team Leader"), true);
    assert.equal(shouldScanForProjects("upload.txt", "AUTO", "Similar assignments and client references"), true);
  });

  it("honours explicit owner categories even when the filename is generic", () => {
    assert.equal(shouldScanForExperts("document.txt", "EXPERT_CV", "Dawit Bekele"), true);
    assert.equal(shouldScanForProjects("document.txt", "PROJECT_CONTRACT", "Adama Water Supply"), true);
    assert.equal(shouldScanForProjects("document.txt", "PORTFOLIO", "Adama Water Supply"), true);
  });

  it("does not manufacture a scan signal for an unrelated explicit document", () => {
    assert.equal(shouldScanForExperts("tax-certificate.txt", "LEGAL_REGISTRATION", "Tax registration certificate"), false);
    assert.equal(shouldScanForProjects("tax-certificate.txt", "LEGAL_REGISTRATION", "Tax registration certificate"), false);
  });
});
