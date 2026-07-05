import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { checkHighValueClaimEvidence } from "../lib/engine/claim-evidence-coverage";

describe("high-value claim evidence coverage", () => {
  it("blocks unsupported Grade 1 claims", () => {
    const findings = checkHighValueClaimEvidence({ tenderText: "Our firm is Grade 1 with strong competence." });
    assert.equal(findings.some((f) => f.category === "CLAIM_EVIDENCE_GRADE" && f.severity === "HIGH"), true);
  });

  it("passes Grade 1 claim when license grade is structured", () => {
    const findings = checkHighValueClaimEvidence({ company: { licenseGrade: "Grade 1" }, tenderText: "Grade 1 consultant" });
    assert.equal(findings.some((f) => f.category === "CLAIM_EVIDENCE_GRADE"), false);
  });

  it("blocks unsupported major-client claims", () => {
    const findings = checkHighValueClaimEvidence({ tenderText: "Relevant clients include UNHCR, IGAD and World Bank." });
    assert.equal(findings.some((f) => f.category === "CLAIM_EVIDENCE_CLIENTS" && f.severity === "HIGH"), true);
  });

  it("passes major-client claims when extracted evidence exists", () => {
    const findings = checkHighValueClaimEvidence({
      tenderText: "World Bank experience",
      company: { documents: [{ id: "d1", category: "PROJECT", extractedText: "Contract reference with World Bank for design services and implementation support.", aiExtractionStatus: "EXTRACTED" }] },
    });
    assert.equal(findings.some((f) => f.category === "CLAIM_EVIDENCE_CLIENTS"), false);
  });

  it("warns when expert claims lack reviewed CV evidence", () => {
    const findings = checkHighValueClaimEvidence({ tenderText: "Key personnel and CVs are required." });
    assert.equal(findings.some((f) => f.category === "CLAIM_EVIDENCE_EXPERTS" && f.severity === "MEDIUM"), true);
  });
});
