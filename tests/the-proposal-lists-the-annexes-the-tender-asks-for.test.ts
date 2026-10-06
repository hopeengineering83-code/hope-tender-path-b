// When the tender asks for supporting documents to be attached, the proposal
// lists them in an Annex Schedule in the tender's order; it never
// answers "available on request" to a tender that already asked. The owner
// attaches the originals. A tender that asks for no attachments is untouched.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { applyAnnexPolicy, tenderAnnexPolicy } from "../lib/engine/annex-policy";
import { buildComplianceMatrixSection, inferProposalLocation } from "../lib/engine/compliance-matrix-builder";
import { reorderSectionsAndRebuildToc } from "../lib/engine/section-orderer-and-toc";

const ATTACH = "Annexes / Supporting Documents — Attach supporting documents such as company profile, project references, professional CVs, licenses, and certificates.";

describe("the annexes the tender asks for", () => {
  it("are read from attach/enclose/evidence-of rows, in the tender's order", () => {
    const policy = tenderAnnexPolicy([
      "Technical Approach — Describe the approach to the design.",
      ATTACH,
      "Valid Business License — Provide evidence of a valid business license and registration.",
    ]);
    assert.equal(policy.required, true);
    assert.deepEqual(policy.items.slice(0, 4), [
      "Company profile",
      "Client reference and completion letters for the cited projects",
      "Curricula vitae of the proposed experts",
      "Professional licences and certificates of the proposed experts",
    ]);
    assert.ok(policy.items.includes("Business licence and registration certificates"));
  });

  it("are absent when the tender asks for nothing to be attached", () => {
    assert.equal(tenderAnnexPolicy(["Proposed Team — Describe the team.", "Methodology — Describe the method."]).required, false);
  });

  it("turn 'on request' into the Annex Schedule, list them before the declaration, and never claim they are attached", async () => {
    const md = "## A.3 Team\n\nFull curricula vitae can be provided on request.\n\n# Declaration\n\nSupported by documentary evidence available on request.\n";
    const out = applyAnnexPolicy(md, tenderAnnexPolicy([ATTACH]));
    assert.doesNotMatch(out, /on request/);
    assert.match(out, /Full curricula vitae are listed in the Annex Schedule\./);
    assert.ok(out.indexOf("# Annex Schedule") < out.indexOf("# Declaration"));
    const { PHANTOM_ATTACHMENT_CLAIM } = await import("../lib/engine/detection-patterns");
    assert.doesNotMatch(out, PHANTOM_ATTACHMENT_CLAIM);
    assert.doesNotMatch(out, /\battached\b/i);
    assert.match(out, /- Annex 1: Company profile/);
    assert.equal(applyAnnexPolicy(md, { required: false, items: [] }), md);
  });

  it("the compliance matrix points the attachment requirement at the Annexes list", () => {
    assert.equal(inferProposalLocation({ title: "Annexes / Supporting Documents", description: "Attach supporting documents such as professional CVs and licenses.", requirementType: "ANNEX" } as never), "Annex Schedule");
  });

  it("listing the annexes does not rate the attachment requirement FULLY MET", () => {
    const requirements = [
      { id: "r1", title: "Annexes / Supporting Documents", description: "Attach supporting documents such as company profile, CVs and licenses.", priority: "SCORED" },
      { id: "r2", title: "Cover Letter", description: "Provide a signed cover letter.", priority: "SCORED" },
    ];
    const matrixRows = requirements.map((r) => ({ requirementId: r.id, supportLevel: "PARTIAL", evidenceType: "PROPOSAL_RESPONSE", evidenceReference: "pending until generated" }));
    const section = buildComplianceMatrixSection({ requirements, matrixRows, gaps: [] } as never) ?? "";
    const row = (title: string) => section.split("\n").find((line) => line.includes(title)) ?? "";
    assert.match(row("Annexes / Supporting Documents"), /\| Annex Schedule \|.*\| PARTIALLY MET \|$/);
    assert.match(row("Cover Letter"), /FULLY MET/);
  });

  it("the Annex Schedule closes the proposal body, before the Declaration", () => {
    const md = "# Cover Letter\n\nx\n\n# Declaration\n\ny\n\n# Annex Schedule\n\n- Annex 1: Company profile\n";
    const out = reorderSectionsAndRebuildToc(md).markdown;
    assert.ok(out.indexOf("# Annex Schedule") < out.indexOf("# Declaration"));
  });
});
