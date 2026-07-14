// Tests for pre-generation validation gates
// Updated for content-first authority model:
//   - Draft generation is NEVER blocked by metadata.
//   - Final export metadata eligibility is enforced by the central
//     generation-readiness gate, not this helper.
//   - A passed deadline is a HIGH advisory warning (a deadline extension may
//     have been granted), NEVER a hard block on any workflow step.
//   - A missing deadline is advisory only.
//   - A placeholder or contaminated clientName is a warning, not a block,
//     for both draft and the local pre-export check. The canonical
//     export gate remains the single source of truth for hard blocks.

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

  it("does NOT block when deadline is in the past (content-first: extension may have been granted)", async () => {
    const tender = { ...baseTender, deadline: new Date(Date.now() - 1000) };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed when deadline is in the past");
    assert.equal(result.blockers.length, 0, "Passed deadline must NOT produce a blocker");
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes("deadline")),
      "Passed deadline should produce a warning so the user knows to verify",
    );
  });

  it("does NOT block when deadline is missing", async () => {
    const tender = { ...baseTender, deadline: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed when deadline is missing");
    assert.equal(result.blockers.length, 0, "Missing deadline must NOT produce a blocker");
  });

  it("does NOT block when reference number is missing", async () => {
    const tender = { ...baseTender, reference: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed when reference is missing");
    assert.equal(result.blockers.length, 0, "Missing reference must NOT produce a blocker");
  });

  it("does NOT block when submission email is missing", async () => {
    const tender = { ...baseTender, submissionEmails: null };
    const result = await validateTenderBeforeGeneration(tender as any);
    assert.ok(result.valid, "Draft work should proceed when submission email is missing");
    assert.equal(result.blockers.length, 0, "Missing submission email must NOT produce a blocker");
  });
});

describe("validateTenderBeforeExport (advisory mirror of the draft validator)", () => {
  const baseTender = {
    id: "test-1",
    title: "Test Tender",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    clientName: "Test Client",
    submissionMethod: "email",
  };

  it("does NOT hard-block when deadline is in the past (content-first: extension may have been granted)", async () => {
    const tender = { ...baseTender, deadline: new Date(Date.now() - 1000) };
    const result = await validateTenderBeforeExport(tender as any);
    assert.ok(
      !result.blockers.some((b) => b.toLowerCase().includes("deadline")),
      "Passed deadline must NOT be a hard blocker — only an advisory warning",
    );
    assert.ok(result.valid, "validateTenderBeforeExport must remain valid (advisory-only)");
  });

  it("does NOT hard-block placeholder clientName (canonical export gate handles this)", async () => {
    const tender = { ...baseTender, clientName: "Bid-Team to confirm" };
    const result = await validateTenderBeforeExport(tender as any);
    assert.ok(
      !result.blockers.some((b) => b.toLowerCase().includes("clientname")),
      "Placeholder clientName must NOT produce a blocker here — the canonical export gate is the sole authority",
    );
  });

  it("does NOT hard-block contaminated clientName (canonical export gate handles this)", async () => {
    const tender = { ...baseTender, clientName: "Ministry XYZ | Tender Portal | Old Tender" };
    const result = await validateTenderBeforeExport(tender as any);
    assert.ok(
      !result.blockers.some((b) => b.toLowerCase().includes("clientname")),
      "Contaminated clientName must NOT produce a blocker here — the canonical export gate is the sole authority",
    );
  });

  it("passes with future deadline and clean data", async () => {
    const result = await validateTenderBeforeExport(baseTender as any);
    assert.ok(
      !result.blockers.some((b) => b.toLowerCase().includes("deadline")),
      "Should not block with future deadline",
    );
  });

  it("returns a warning (not a blocker) when deadline has passed", async () => {
    const tender = { ...baseTender, deadline: new Date(Date.now() - 1000) };
    const result = await validateTenderBeforeExport(tender as any);
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes("deadline")),
      "Passed deadline should produce a warning so the user knows to verify",
    );
  });
});
