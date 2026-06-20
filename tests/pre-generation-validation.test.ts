// Tests for pre-generation validation gates (placeholder and contamination detection)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTenderBeforeGeneration, validateTenderBeforeExport } from "../lib/engine/pre-generation-validation";

describe("validateTenderBeforeGeneration", () => {
  const baseTender = {
    id: "test-1",
    title: "Test Tender",
    clientName: "Test Client",
    submissionMethod: "email",
    submissionAddress: "test@example.com",
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Test Client",
    requirements: [] as Array<{ id: string; sourcePageNumber?: number | null; sourceQuote?: string | null }>,
  };

  it("passes validation for clean tender data", async () => {
    const result = await validateTenderBeforeGeneration(baseTender as any);
    assert.ok(result.valid, "Clean tender should pass validation");
    assert.equal(result.blockers.length, 0, "Should have no blockers");
  });

  it("blocks placeholder clientName: 'Bid-Team to confirm'", async () => {
    const tender = { ...baseTender, clientName: "Bid-Team to confirm" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should reject placeholder clientName");
    assert.ok(
      result.blockers.some((b) => b.includes("clientName")),
      "Should have blocker about clientName",
    );
  });

  it("blocks placeholder clientName: 'unknown'", async () => {
    const tender = { ...baseTender, clientName: "unknown" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should reject placeholder clientName");
    assert.ok(
      result.blockers.some((b) => b.includes("clientName")),
      "Should have blocker about clientName",
    );
  });

  it("blocks placeholder clientName: 'TBD'", async () => {
    const tender = { ...baseTender, clientName: "TBD" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should reject placeholder clientName");
  });

  it("blocks placeholder submissionMethod: 'N/A'", async () => {
    const tender = { ...baseTender, submissionMethod: "N/A" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should reject placeholder submissionMethod");
    assert.ok(
      result.blockers.some((b) => b.includes("submissionMethod")),
      "Should have blocker about submissionMethod",
    );
  });

  it("blocks contaminated clientName with pipe character", async () => {
    const tender = { ...baseTender, clientName: "Ministry XYZ | Tender Portal | Old Tender" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should reject contaminated clientName");
    assert.ok(
      result.blockers.some((b) => b.includes("contamination") || b.includes("pipe")),
      "Should identify contamination issue",
    );
  });

  it("requires source page when clientName is extracted", async () => {
    const tender = { ...baseTender, clientNameSourcePage: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should require source page for extracted client");
    assert.ok(
      result.blockers.some((b) => b.includes("source")),
      "Should have blocker about source page",
    );
  });

  it("requires source quote when clientName is extracted", async () => {
    const tender = { ...baseTender, clientNameSourceQuote: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(!result.valid, "Should require source quote for extracted client");
    assert.ok(
      result.blockers.some((b) => b.includes("source")),
      "Should have blocker about source quote",
    );
  });
});

describe("validateTenderBeforeExport", () => {
  const baseTender = {
    id: "test-1",
    title: "Test Tender",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    clientName: "Test Client",
    submissionMethod: "email",
  };

  it("blocks export when deadline is in the past", () => {
    const tender = { ...baseTender, deadline: new Date(Date.now() - 1000) };
    const result = validateTenderBeforeExport(tender as any);
    assert.ok(
      result.blockers.some((b) => b.includes("deadline") || b.includes("DEADLINE_PASSED")),
      "Should block when deadline is in past",
    );
  });

  it("blocks placeholder clientName", () => {
    const tender = { ...baseTender, clientName: "Bid-Team to confirm" };
    const result = validateTenderBeforeExport(tender as any);
    assert.ok(
      result.blockers.some((b) => b.includes("clientName")),
      "Should block placeholder clientName",
    );
  });

  it("passes with future deadline and clean data", () => {
    const result = validateTenderBeforeExport(baseTender as any);
    assert.ok(
      !result.blockers.some((b) => b.includes("deadline")),
      "Should not block with future deadline",
    );
  });
});
