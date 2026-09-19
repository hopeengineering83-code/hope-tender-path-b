// Evidence must land on a claim, and must not be restated locally.
//
// TWO DELIVERED DEFECTS
// ---------------------
// 1. A project citation was appended to the firm's postal address. Section A.1
//    of a submitted Technical Proposal read:
//
//      "Address: Addis Ababa, Sarbet - NOC Building, 1st Floor; branch offices
//       at Hayahulet (Addis Ababa) and Kombolcha (Fikir Building, 1st Floor).
//       G+6 General Hospital – Dr Abdul Seid (…) demonstrates the firm's prior
//       delivery of this exact scope element."
//
//    The injector's skip list understood structure — headings, bullets, table
//    rows — but not meaning, so an address block passed as ordinary prose.
//
// 2. The same reviewed project was introduced four times inside ten lines,
//    through four different sentence templates, because several generators each
//    append their own proof sentence and none can see the others.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  isClaimBearingDestination,
  evidenceSupportsProposition,
  mayAttachEvidence,
} from "../lib/engine/claim-bearing-destination";
import {
  EvidenceRepetitionWindow,
  spanAlreadyCites,
} from "../lib/engine/evidence-repetition-control";
import { injectEvidenceMarkers } from "../lib/engine/evidence-marker-injector";

const HOSPITAL = {
  name: "G+6 General Hospital – Dr Abdul Seid",
  sector: "Healthcare",
  serviceAreas: JSON.stringify(["Architectural design", "Structural engineering", "MEP design"]),
  summary: "Hospital design covering clinical zoning, medical gas reticulation and MEP coordination.",
  clientName: "Gimba City Administration",
  country: "Ethiopia",
  contractValue: 7_000_000,
  currency: "ETB",
} as unknown as { name: string; sector: string; serviceAreas: string; summary: string; clientName: string; country: string; contractValue: number; currency: string };

describe("evidence attaches only to a claim-bearing destination", () => {
  it("refuses the address block that was cited in a delivered proposal", () => {
    const address = "Address: Addis Ababa, Sarbet - NOC Building, 1st Floor; branch offices at "
      + "Hayahulet (Addis Ababa) and Kombolcha (Fikir Building, 1st Floor).";
    const verdict = isClaimBearingDestination(address);
    assert.equal(verdict.eligible, false, `an address block must never carry a citation (${verdict.reason})`);
  });

  for (const [label, block] of [
    ["email line", "Submission email: edessalegn@pharoventures.com and fgetachewdesta@pharoventures.com must both receive the technical proposal."],
    ["phone line", "Tel: +251 911 169 930 / +251 921 269 277 for any clarification during the bid window."],
    ["running footer", "+251 911 169 930 / +251 921 269 277 | hopeengineering83@gmail.com | hopearchitectural.com Page 5 of 36"],
    ["signature block", "Signed for and on behalf of Hope Urban Planning Architectural and Engineering Consultancy PLC by the duly authorised representative."],
    ["submission metadata", "Subject: Technical Proposal for Pharo Ventures. Deadline: 25 August 2026 5:00 PM. Sector: Healthcare."],
    ["table row", "| Deliverable | Owner | Gate | Evidence produced at handover for the clinical team |"],
    ["heading", "## C.4 Work Plan and Deliverables for the medical centre assignment across all phases"],
    ["bullet", "- Medical gas reticulation coordinated with the structural grid across every clinical zone."],
  ] as Array<[string, string]>) {
    it(`refuses a ${label}`, () => {
      assert.equal(isClaimBearingDestination(block).eligible, false, `${label} must be refused`);
    });
  }

  it("accepts real prose that makes a claim", () => {
    const prose = "The clinical brief drives every downstream decision: zone segregation between "
      + "Emergency, Outpatient and Imaging, infection-prevention compliant flow patterns, and "
      + "medical gas distribution coordinated with the structural and MEP grids.";
    assert.equal(isClaimBearingDestination(prose).eligible, true);
  });
});

describe("evidence must bear on the proposition", () => {
  it("relates a hospital record to a clinical-planning paragraph", () => {
    const prose = "Our clinical zoning approach separates inpatient and outpatient circulation and "
      + "coordinates medical gas reticulation with the structural grid at schematic stage.";
    assert.equal(evidenceSupportsProposition(prose, HOSPITAL), true);
  });

  it("refuses to attach a hospital record to an unrelated paragraph", () => {
    const prose = "Invoices are issued monthly against certified progress and settled within thirty "
      + "days of receipt, with any disputed amount escalated to the contract administrator.";
    assert.equal(evidenceSupportsProposition(prose, HOSPITAL), false);
  });

  it("mayAttachEvidence requires both conditions", () => {
    const address = "Address: Addis Ababa, Sarbet - NOC Building, 1st Floor; branch offices at "
      + "Hayahulet and Kombolcha for hospital and clinical design work.";
    // Even though the address mentions "hospital" and "clinical", it is not a claim.
    assert.equal(mayAttachEvidence(address, HOSPITAL).eligible, false);
  });
});

describe("the same record is not re-introduced locally", () => {
  it("refuses a second introduction inside the window and allows one beyond it", () => {
    const window = new EvidenceRepetitionWindow(2_500);
    assert.equal(window.canIntroduce(HOSPITAL.name, 0), true);
    window.record(HOSPITAL.name, 0);
    assert.equal(window.canIntroduce(HOSPITAL.name, 400), false, "ten lines later is still the same page");
    assert.equal(window.canIntroduce(HOSPITAL.name, 3_000), true, "a page later is a legitimate re-use");
  });

  it("does not restrict a different record", () => {
    const window = new EvidenceRepetitionWindow(2_500);
    window.record("G+6 General Hospital – Dr Abdul Seid", 0);
    assert.equal(window.canIntroduce("Hawassa Referral Hospital", 200), true);
  });

  it("sees citations earlier generators already wrote", () => {
    const window = new EvidenceRepetitionWindow(2_500);
    const existing = `Intro paragraph.\n\nComparable scope was completed on ${HOSPITAL.name} (ETB 7,000,000).`;
    window.seedFromMarkdown(existing, [HOSPITAL.name]);
    assert.equal(window.canIntroduce(HOSPITAL.name, existing.length + 50), false);
  });

  it("spanAlreadyCites detects an existing citation in a section", () => {
    const span = `Our approach mirrors the methodology proven on ${HOSPITAL.name}.`;
    assert.equal(spanAlreadyCites(span, [HOSPITAL.name]), true);
    assert.equal(spanAlreadyCites("No citation here at all.", [HOSPITAL.name]), false);
  });
});

describe("the injector as a whole", () => {
  it("leaves an address paragraph un-cited and anchors the clinical one", () => {
    const md = [
      "# Section A: Company Profile",
      "",
      "Address: Addis Ababa, Sarbet - NOC Building, 1st Floor; branch offices at Hayahulet (Addis Ababa) and Kombolcha (Fikir Building, 1st Floor).",
      "",
      "The firm's clinical planning approach separates inpatient and outpatient circulation, coordinates medical gas reticulation with the structural grid, and applies infection-prevention zoning from schematic design onward for every hospital assignment.",
      "",
    ].join("\n");

    const { markdown } = injectEvidenceMarkers(md, [HOSPITAL]);
    const paragraphs = markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const addressPara = paragraphs.find((p) => p.startsWith("Address:"))!;
    const clinicalPara = paragraphs.find((p) => p.startsWith("The firm's clinical planning"))!;

    assert.ok(
      !addressPara.includes("G+6 General Hospital"),
      `the address must not be cited — got: ${addressPara}`,
    );
    assert.ok(
      clinicalPara.includes("G+6 General Hospital"),
      "a genuinely related clinical paragraph should still receive its anchor",
    );
  });

  it("does not cite the same project twice in adjacent paragraphs", () => {
    const clinical = "The firm's clinical planning approach separates inpatient and outpatient circulation "
      + "and coordinates medical gas reticulation with the structural grid for this hospital assignment.";
    const md = ["# Section C: Technical Approach", "", clinical, "", clinical.replace("separates", "organises"), ""].join("\n");

    const { markdown } = injectEvidenceMarkers(md, [HOSPITAL]);
    const mentions = (markdown.match(/G\+6 General Hospital/g) ?? []).length;
    assert.ok(mentions <= 1, `one local introduction is enough, got ${mentions}`);
  });

  it("injects nothing when the evidence library is empty", () => {
    const md = "# Section C\n\nA clinical planning paragraph about hospital zoning and medical gas.\n";
    assert.equal(injectEvidenceMarkers(md, []).injected, 0);
  });
});
