import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceGroundedRequirementMap } from "../lib/engine/source-grounded-requirement-map";
import { validateSourceQuote } from "../lib/engine/source-quote-validator";

test("Source Grounded Requirement Map: preserves quotes and pages", async () => {
  const tenderSources = [
    {
      id: "doc1",
      name: "Tender.pdf",
      text: "[page 1]\nSection 1.1 Requirements\nThe bidder shall provide 12km of DN600 pipe.\n\n[page 2]\nSection 1.2 Personnel\nThe project manager must have 10 years experience."
    }
  ];

  const requirements = [
    "The bidder shall provide 12km of DN600 pipe.",
    "The project manager must have 10 years experience."
  ];

  const map = buildSourceGroundedRequirementMap({
    requirements,
    tenderSources
  });

  assert.equal(map.length, 2);
  assert.equal(map[0].sourcePageNumber, 1);
  assert.ok(map[0].sourceExactQuote?.includes("12km of DN600 pipe"));
  assert.equal(map[1].sourcePageNumber, 2);
  assert.ok(map[1].sourceExactQuote?.includes("10 years experience"));
  assert.ok(map[0].grounded);
  assert.ok(map[1].grounded);
});

test("Source Quote Validator: verifies quotes accurately", async () => {
  const sourceText = "The bidder shall provide 12km of DN600 pipe in Addis Ababa.";

  const validResult = validateSourceQuote("12km of DN600 pipe", sourceText);
  assert.equal(validResult.status, "QUOTE_VERIFIED");

  const invalidResult = validateSourceQuote("15km of DN800 pipe", sourceText);
  assert.equal(invalidResult.status, "QUOTE_NOT_FOUND");
});

test("Requirement source extractor should handle noisy text", async () => {
   // This tests lexical fallback in buildSourceGroundedRequirementMap
   const tenderSources = [
    {
      id: "doc1",
      name: "Tender.pdf",
      text: "Some random header\n\n[page 5]\nTechnical Specifications: We need 500 units of solar panels.\n\nFooter text"
    }
  ];

  const requirements = [
    "500 units of solar panels"
  ];

  const map = buildSourceGroundedRequirementMap({
    requirements,
    tenderSources
  });

  assert.equal(map[0].sourcePageNumber, 5);
  assert.ok(map[0].sourceExactQuote?.includes("solar panels"));
});
