/**
 * A rule about signing and sealing the submission is not proven by a vault
 * record.
 *
 * 2026-09-29, Preview (accept run 36607216304): every job succeeded and export
 * stopped on MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE 8/9. The one row was
 * "Bid Submission Format" — "The proposal must contain the signature of the
 * authorized person and the seal of the company with the address." It matched
 * no packaging phrase, fell through to the GENERAL wildcard, and the
 * company's CV pack was selected as its evidence at PARTIAL.
 *
 * Generic fixtures; the benchmark tender is not involved.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isPackagingOrFormatRequirement } from "../lib/engine/packaging-requirement-rule";
import { classifyPackageRule } from "../lib/engine/package-conformance";
import { inferAutomaticEvidenceKinds } from "../lib/engine/automatic-requirement-coverage";

const SIGNING_RULES = [
  { title: "Bid Submission Format", description: "The proposal must contain the signature of the authorized person and the seal of the company with the address.", requirementType: "FORMAT" },
  { title: "Execution", description: "Each page of the offer shall be signed and stamped by the authorised representative.", requirementType: "FORMAT" },
  { title: "Signing", description: "The technical proposal must bear the company seal.", requirementType: "TECHNICAL" },
];

describe("signing and sealing rules are artifact rules", () => {
  for (const rule of SIGNING_RULES) {
    it(`"${rule.description.slice(0, 50)}…" never reaches the GENERAL wildcard`, () => {
      assert.equal(isPackagingOrFormatRequirement(rule), true);
      assert.deepEqual(inferAutomaticEvidenceKinds({ id: "r", priority: "MANDATORY", ...rule } as any), ["PACKAGE_FORMAT"]);
    });
    it(`"${rule.description.slice(0, 50)}…" is not machine-decidable, never claimed met`, () => {
      assert.equal(classifyPackageRule({ id: "r", ...rule } as any), "NOT_MACHINE_DECIDABLE");
    });
  }

  it("a signed FORM or declaration keeps its evidence link", () => {
    assert.equal(isPackagingOrFormatRequirement({ title: "Declaration", description: "Submit the signed declaration form issued with the tender.", requirementType: "DECLARATION" }), false);
    assert.equal(isPackagingOrFormatRequirement({ title: "Key experts", description: "CVs signed by the expert and the authorized representative.", requirementType: "EXPERT" }), false);
  });
});
