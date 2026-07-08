// Tests for pre-generation validation gates
// Updated for metadata-optional policy: draft generation is NEVER blocked by metadata.
// Export validation remains strict.

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

  it("does NOT block placeholder clientName for draft: 'Bid-Team to confirm'", async () => {
    const tender = { ...baseTender, clientName: "Bid-Team to confirm" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed with placeholder clientName");
    assert.ok(result.warnings.some((w) => w.includes("clientName")), "Should have warning about clientName");
  });

  it("does NOT block placeholder clientName for draft: 'unknown'", async () => {
    const tender = { ...baseTender, clientName: "unknown" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed with placeholder clientName");
  });

  it("does NOT block placeholder clientName for draft: 'TBD'", async () => {
    const tender = { ...baseTender, clientName: "TBD" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed with placeholder clientName");
  });

  it("does NOT block placeholder submissionMethod for draft: 'N/A'", async () => {
    const tender = { ...baseTender, submissionMethod: "N/A" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed with placeholder submissionMethod");
    assert.ok(result.warnings.some((w) => w.includes("submissionMethod")), "Should have warning about submissionMethod");
  });

  it("does NOT block contaminated clientName for draft", async () => {
    const tender = { ...baseTender, clientName: "Ministry XYZ | Tender Portal | Old Tender" };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed with contaminated clientName");
    assert.ok(result.warnings.some((w) => w.includes("contaminated") || w.includes("portal")), "Should have warning about contamination");
  });

  it("does NOT block missing source page for draft", async () => {
    const tender = { ...baseTender, clientNameSourcePage: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed without source page");
    assert.ok(result.warnings.some((w) => w.includes("source")), "Should have warning about source page");
  });

  it("does NOT block missing source quote for draft", async () => {
    const tender = { ...baseTender, clientNameSourceQuote: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed without source quote");
    assert.ok(result.warnings.some((w) => w.includes("source")), "Should have warning about source quote");
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
      result.blockers.some((b) => b.includes("deadline")),
      "Should block when deadline is in past",
    );
  });

  it("blocks placeholder clientName for export", () => {
    const tender = { ...baseTender, clientName: "Bid-Team to confirm" };
    const result = validateTenderBeforeExport(tender as any);
    assert.ok(
      result.blockers.some((b) => b.includes("clientName")),
      "Should block placeholder clientName for export",
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
