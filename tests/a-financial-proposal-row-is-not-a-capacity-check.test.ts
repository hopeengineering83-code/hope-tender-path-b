// "The Financial Proposal shall be submitted in a separate envelope, priced in
// ETB" asks for a deliverable priced from the owner's workbook. The engine
// checked it against audited financial statements in the Company Vault and,
// with none there, recorded a CRITICAL gap that blocked export even after the
// owner priced the workbook. A financial-capacity requirement (turnover,
// audited accounts) still needs Vault evidence.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildCompliance } from "../lib/engine/compliance";

const knowledge = { experts: [], projects: [], legalRecords: [], financialRecords: [], complianceRecords: [], documents: [] } as never;
const matching = { expertMatches: [], projectMatches: [] } as never;
const row = (id: string, title: string, description: string) => ({
  id, requirement: { title, description, requirementType: "FINANCIAL", priority: "MANDATORY", requiredQuantity: null } as never,
});

describe("a financial proposal row is a deliverable, not a capacity check", () => {
  it("raises no evidence gap for the priced financial proposal", () => {
    const result = buildCompliance([row("f", "Financial Proposal", "The Financial Proposal shall be submitted in a separate envelope, priced in ETB inclusive of VAT.")], knowledge, matching);
    assert.equal(result.gaps.filter((g: any) => g.requirementId === "f" && g.severity === "CRITICAL").length, 0, JSON.stringify(result.gaps));
    assert.equal(result.matrices[0]!.evidenceType, "PROPOSAL_RESPONSE");
  });

  it("still requires Vault evidence for financial capacity", () => {
    const result = buildCompliance([row("c", "Average Annual Turnover", "Bidders shall demonstrate an average annual turnover of ETB 20 million over the last three years, supported by audited financial statements.")], knowledge, matching);
    assert.equal(result.gaps.filter((g: any) => g.requirementId === "c" && g.severity === "CRITICAL").length, 1);
  });
});
