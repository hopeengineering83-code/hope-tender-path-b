import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { detectSubmissionPackageMode } from "../lib/engine/submission-package-mode";

describe("submission package mode detection", () => {
  it("enables separately scoped ZIPs when technical and financial submissions must be separate", () => {
    const result = detectSubmissionPackageMode({
      requirements: [{ title: "Two envelope submission", description: "Technical proposal and financial proposal must be submitted in separate sealed envelopes." }],
    });
    assert.equal(result.mode, "SEPARATE_TECHNICAL_FINANCIAL");
    assert.equal(result.blockingForZip, false);
    assert.match(result.reason, /isolated Technical, Financial.*Admin ZIPs/i);
  });

  it("blocks default ZIP when a single combined PDF is required", () => {
    const result = detectSubmissionPackageMode({ notes: "Submit one combined PDF containing all documents." });
    assert.equal(result.mode, "SINGLE_COMBINED_PDF");
    assert.equal(result.blockingForZip, true);
  });

  it("blocks default ZIP when portal upload is detected", () => {
    const result = detectSubmissionPackageMode({ submissionMethod: "Upload through the e-procurement portal." });
    assert.equal(result.mode, "PORTAL_UPLOAD");
    assert.equal(result.blockingForZip, true);
  });

  it("allows ZIP when ZIP is explicitly required", () => {
    const result = detectSubmissionPackageMode({ exactFileNaming: JSON.stringify(["Final Submission.zip"]) });
    assert.equal(result.mode, "SINGLE_ZIP");
    assert.equal(result.blockingForZip, false);
  });

  it("allows email attachments with a warning-level mode", () => {
    const result = detectSubmissionPackageMode({ submissionMethod: "Submit by email attachments to procurement@example.org" });
    assert.equal(result.mode, "EMAIL_ATTACHMENTS");
    assert.equal(result.blockingForZip, false);
  });
});
