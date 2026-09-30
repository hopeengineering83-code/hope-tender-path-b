/**
 * A source page the text proves is not a reason to refuse Run Engine.
 *
 * 2026-09-30, Preview, a newly uploaded 4-page EOI: every Run Engine failed at
 * the Build Plan with "TENDER_FACTS_INVALID: … Critical metadata field
 * reference has invalid source page." The stated reference number had a file
 * id and a quote the file contains; the model had returned no page.
 *
 * Generic fixture; the tender under test is not reproduced.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateCriticalMetadataEvidenceForBuildPlan } from "../lib/engine/build-plan";
import { provenPageOfQuote } from "../lib/engine/page-provenance";

const PAGE_1 = "EXPRESSION OF INTEREST\nProvision of Tower Maintenance Services\nIssued by Sample Networks PLC";
const PAGE_2 = "Reference No: EOI-TWR-2026-07\nSubmission by email to tenders@example.com before 15 October 2026.";
const TEXT = `${PAGE_1}\f${PAGE_2}`;
const files = [{ id: "f1", extractedText: TEXT, totalPages: 2 }];

function tender(overrides: Record<string, unknown> = {}) {
  return {
    reference: "EOI-TWR-2026-07",
    contactDetailsSourceJson: JSON.stringify({
      procurementReferenceNumber: { page: null, quote: "Reference No: EOI-TWR-2026-07", fileId: "f1" },
    }),
    ...overrides,
  };
}

describe("a provable page does not block Run Engine", () => {
  it("finds the page a quote sits on", () => {
    assert.equal(provenPageOfQuote(TEXT, "Reference No: EOI-TWR-2026-07", 2), 2);
    assert.equal(provenPageOfQuote(TEXT, "Provision of Tower  Maintenance Services", 2), 1);
    assert.equal(provenPageOfQuote(TEXT, "a sentence the file never says", 2), null);
  });

  it("a reference with a contained quote but no page passes the Build Plan", () => {
    const result = validateCriticalMetadataEvidenceForBuildPlan(tender() as any, files, [], "final");
    assert.ok(!result.blockers.some((b) => /reference/.test(b)), result.blockers.join("; "));
  });

  it("a reference whose quote the file does not contain still blocks", () => {
    const result = validateCriticalMetadataEvidenceForBuildPlan(
      tender({
        contactDetailsSourceJson: JSON.stringify({
          procurementReferenceNumber: { page: null, quote: "Reference No: SOMETHING-ELSE-99", fileId: "f1" },
        }),
      }) as any,
      files,
      [],
      "final",
    );
    assert.ok(result.blockers.some((b) => /reference/.test(b)), "an unprovable reference must still block");
  });
});
