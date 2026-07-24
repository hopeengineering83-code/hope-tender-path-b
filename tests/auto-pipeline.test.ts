// Auto-pipeline trigger — contract tests.
//
// The auto-pipeline module (lib/ui/auto-pipeline.ts) replaces the previous
// "Open the tender and run AI Analyze" silent skip with a visible
// "Pipeline auto-started" badge. These tests verify the decision logic
// without making actual network calls (the trigger function is async and
// uses fetch — the decision function is pure).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  decideTenderUploadAutoPipeline,
  type UploadFirstResponse,
} from "../lib/ui/auto-pipeline";

describe("auto-pipeline — decideTenderUploadAutoPipeline", () => {
  it("returns null when the upload did not succeed", () => {
    const response: UploadFirstResponse = {
      success: false,
      error: "Upload failed",
      tenderId: "tender-123",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
  });

  it("returns null when tenderId is missing", () => {
    const response: UploadFirstResponse = {
      success: true,
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
  });

  it("returns null when engineSkipped is not true", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-123",
      engineSkipped: false,
      nextAction: "RUN_AI_ANALYZE",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
  });

  it("returns null when nextAction is not RUN_AI_ANALYZE", () => {
    // The server can opt out of auto-pipeline by advertising a different
    // next action — e.g. RUN_OCR_OR_REEXTRACT, which requires user-choices
    // (which file to re-extract).
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-123",
      engineSkipped: true,
      nextAction: "RUN_OCR_OR_REEXTRACT",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
  });

  it("returns the AI Analyze endpoint when success + tenderId + engineSkipped + RUN_AI_ANALYZE", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "tender-abc",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    const decision = decideTenderUploadAutoPipeline(response);
    assert.ok(decision, "Expected a non-null decision");
    assert.equal(decision!.method, "POST");
    assert.equal(decision!.endpoint, "/api/tenders/tender-abc/ai-analyze?mode=background");
  });

  it("treats success: undefined as success when tenderId is present", () => {
    // The upload-first route returns 201 with tenderId but does not always
    // set success: true. The auto-pipeline module must treat this as
    // success so it fires the AI Analyze trigger.
    const response: UploadFirstResponse = {
      tenderId: "tender-xyz",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    const decision = decideTenderUploadAutoPipeline(response);
    assert.ok(decision, "Expected a non-null decision when tenderId is present and success is undefined");
    assert.equal(decision!.endpoint, "/api/tenders/tender-xyz/ai-analyze?mode=background");
  });

  it("does NOT fire when success is explicitly false even if tenderId is present", () => {
    const response: UploadFirstResponse = {
      success: false,
      tenderId: "tender-xyz",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
    };
    assert.equal(decideTenderUploadAutoPipeline(response), null);
  });
});

describe("auto-pipeline — typed contract surface", () => {
  // The auto-pipeline module declares typed shapes for the upload responses
  // it consumes. These tests verify the shapes include the fields the
  // trigger logic reads, so a backend change that drops `engineSkipped` or
  // `nextAction` is caught by TypeScript at the call site.

  it("UploadFirstResponse includes engineSkipped and nextAction", () => {
    const response: UploadFirstResponse = {
      success: true,
      tenderId: "t-1",
      engineSkipped: true,
      nextAction: "RUN_AI_ANALYZE",
      error: undefined,
      code: undefined,
      requestId: "req-1",
    };
    // Touching the fields proves they exist on the type.
    assert.equal(response.engineSkipped, true);
    assert.equal(response.nextAction, "RUN_AI_ANALYZE");
  });
});
