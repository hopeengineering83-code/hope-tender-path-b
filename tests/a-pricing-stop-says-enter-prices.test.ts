// A financial proposal waiting for the owner's prices says so.
//
// 2026-10-07, a feasibility-study ToR: the package stopped only because the
// pricing workbook had no priced line — correct, the app never sets a price —
// but every surface told the owner to "replace it with the tender-issued
// original", "upload your signed original" or "generate the missing
// documents". The row stays non-exportable; only the explanation changes.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { exportBlockReason } from "../lib/engine/document-output-state";
import { isAwaitingOwnerPricing, OWNER_PRICING_ACTION } from "../lib/engine/owner-pricing-stop";
import { presentTwoActionWorkflowDecision } from "../lib/engine/two-action-workflow-presentation";

const pricingRow = { exactFileName: "Financial Proposal.docx", name: "Financial Proposal", documentType: "FINANCIAL", reviewStatus: "REPLACE_WITH_ORIGINAL" };
const formRow = { exactFileName: "Supplier Declaration Form.pdf", name: "Supplier Declaration Form", documentType: "FORM", reviewStatus: "REPLACE_WITH_ORIGINAL" };

describe("a financial proposal waiting for prices says: enter the prices", () => {
  it("recognises the pricing row and nothing else", () => {
    assert.equal(isAwaitingOwnerPricing(pricingRow), true);
    assert.equal(isAwaitingOwnerPricing(formRow), false);
    assert.equal(isAwaitingOwnerPricing({ ...pricingRow, reviewStatus: "READY_FOR_EXPORT" }), false, "a priced proposal is not waiting");
  });

  it("the document's block reason names the pricing workbook", () => {
    const reason = exportBlockReason("ORIGINAL_REQUIRED", pricingRow)!;
    assert.match(reason, /pricing workbook/);
    assert.doesNotMatch(reason, /tender-issued original/);
    assert.match(exportBlockReason("ORIGINAL_REQUIRED", formRow)!, /tender-issued original/, "a tender form keeps its own reason");
  });

  it("the next owner action is to enter prices, not to upload an original", () => {
    const base = {
      currentBlockingStage: "REQUIRED_DOCS_NOT_GENERATED",
      requiredDocumentsTotal: 2,
      generatedDocumentsTotal: 1,
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      nextRequiredActionLabel: "",
      nextRequiredActionReason: "",
    };
    const only = presentTwoActionWorkflowDecision({ ...base, awaitingOwnerOriginalFileNames: [], awaitingOwnerPricingFileNames: ["Financial Proposal.docx"] } as never)!;
    assert.equal(only.nextRequiredAction, "ENTER_OWNER_PRICING");
    assert.ok(only.nextRequiredActionReason.includes(OWNER_PRICING_ACTION));
    assert.doesNotMatch(only.nextRequiredActionReason, /signed original/);

    const both = presentTwoActionWorkflowDecision({ ...base, requiredDocumentsTotal: 3, awaitingOwnerOriginalFileNames: ["Supplier Declaration Form.pdf"], awaitingOwnerPricingFileNames: ["Financial Proposal.docx"] } as never)!;
    assert.equal(both.nextRequiredAction, "ENTER_OWNER_PRICING");
    assert.match(both.nextRequiredActionReason, /Supplier Declaration Form\.pdf/);
  });
});
