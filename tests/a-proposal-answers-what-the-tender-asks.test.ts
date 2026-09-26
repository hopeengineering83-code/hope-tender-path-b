// A proposal answers what the tender asks, and claims only what the record holds.
//
// Delivered proposal, Preview run 36040407147 (2026-09-24): a 40-page
// technical proposal for a tender that asks for eight sections carried a
// 63-entry contents page. After Section F it appended a Sustainability and
// ESG Plan, a Health and Safety Plan, Innovation and Value Engineering
// Proposals, Local Content and Capacity Building, and an Anti-Bribery
// declaration. None was asked for, and each committed the firm to policies,
// KPIs or sworn statements its records do not hold ("not under any current
// debarment, suspension, sanction"). It also offered services "at no
// additional charge" in a technical-only envelope, said certificates and CVs
// were "attached as Appendix A / C" when the package held one PDF, printed
// the bid desk's submission rules as a Section A heading, and mapped every
// expert to the same hospital with the role "Senior <their title>".
//
// The tender text here is generic; nothing in these tests is tied to that
// tender beyond the shapes of the defects.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { tenderAsksFor } from "../lib/engine/tender-asks-for";
import { injectBeyondSpecTables } from "../lib/engine/beyond-spec-tables";
import { injectTenderClosers } from "../lib/engine/tender-closers";
import { buildValueAddedServices, buildCertificationsSection } from "../lib/engine/understanding-and-value-added";
import { buildProposedTeamTable, buildTeamToProjectMappingTable } from "../lib/engine/benchmark-tables";
import { projectsNamedInCv, softwareNamedInCv } from "../lib/engine/cv-grounding";
import type { ExpertRecord, ProjectRecord } from "../lib/engine/benchmark-tables";

const SILENT_TENDER = [
  "Request for Technical Proposal: design of a district clinic.",
  "Scope: site assessment, concept and detailed design, MEP coordination, approvals, supervision of works and close-out.",
  "The design shall meet the building regulations, safety requirements and applicable approval processes.",
  "Proposal Validity: Not mentioned. Financial proposal: not required at this stage.",
  "Evaluation: relevant experience, team strength, methodology, compliance with submission requirements.",
].join("\n");

const ESG_TENDER = `${SILENT_TENDER}\nThe consultant shall describe its environmental and social safeguards and a health and safety plan for site works.`;

const ETHICS_VAULT = { companyName: "Firm", legalName: null, gmName: null, gmTitle: null, gmLicense: null, codeOfEthicsRef: null, countryLegalCitation: null };

describe("tenderAsksFor reads topics, not one tender's phrasing", () => {
  it("a tender that raises no supplementary topic asks for none", () => {
    for (const topic of ["sustainability", "health-safety", "innovation", "local-content", "ethics-declaration", "conflict-of-interest-declaration"] as const) {
      assert.equal(tenderAsksFor(topic, SILENT_TENDER), false, topic);
    }
  });

  it("building-regulation 'safety requirements' is not a request for an OH&S plan", () => {
    assert.equal(tenderAsksFor("health-safety", "comply with building regulations and safety requirements"), false);
    assert.equal(tenderAsksFor("health-safety", "submit a health and safety plan"), true);
  });

  it("a suspension bridge is not a debarment question", () => {
    assert.equal(tenderAsksFor("conflict-of-interest-declaration", "design of a suspension bridge"), false);
    assert.equal(tenderAsksFor("conflict-of-interest-declaration", "declare any conflict of interest"), true);
  });

  it("no tender text at all keeps the legacy behaviour", () => {
    assert.equal(tenderAsksFor("sustainability", undefined), true);
  });
});

describe("supplementary sections appear only when the tender raises them", () => {
  const base = "# Section C: Technical Approach\n\nbody\n\n# Section D: Additional Information\n\nbody\n";

  it("a silent tender gets none of the four beyond-spec plans", () => {
    const out = injectBeyondSpecTables(base, { primarySector: "Healthcare", sourceText: SILENT_TENDER });
    assert.doesNotMatch(out.markdown, /Sustainability and ESG Plan|Health and Safety Plan|Innovation and Value Engineering|Local Content and Capacity Building/);
    assert.ok(out.injected.every((i) => i.reason === "SKIPPED_NOT_ASKED"), JSON.stringify(out.injected));
  });

  it("a tender that asks for ESG and H&S gets exactly those", () => {
    const out = injectBeyondSpecTables(base, { primarySector: "Healthcare", sourceText: ESG_TENDER });
    assert.match(out.markdown, /## Sustainability and ESG Plan/);
    assert.match(out.markdown, /## Health and Safety Plan/);
    assert.doesNotMatch(out.markdown, /Local Content and Capacity Building|Innovation and Value Engineering/);
  });

  it("the anti-bribery declaration is written only when the tender calls for one", () => {
    const silent = injectTenderClosers(base, { tenderText: SILENT_TENDER, ethicsVault: ETHICS_VAULT });
    assert.equal(silent.injected.ethics, false);
    assert.doesNotMatch(silent.markdown, /Anti-Bribery/);
    const asked = injectTenderClosers(base, { tenderText: `${SILENT_TENDER}\nBidders shall sign an anti-corruption and integrity declaration.`, ethicsVault: ETHICS_VAULT });
    assert.equal(asked.injected.ethics, true);
  });

  it("the no-conflict declaration is gated at its call site", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(src, /tenderAsksFor\("conflict-of-interest-declaration", tenderText\)/);
  });
});

describe("no price and no phantom attachment in a technical-only envelope", () => {
  it("value-added services carry no 'no additional charge' or 'free'", () => {
    for (const sector of ["Healthcare", "Water supply", "Roads", "General consultancy"]) {
      const md = buildValueAddedServices({ primarySector: sector, companyName: "Firm" });
      assert.doesNotMatch(md, /no additional charge|no extra cost|free input|\bfree\b/i, sector);
    }
  });

  it("certifications are not said to be attached", () => {
    const md = buildCertificationsSection({ experts: [], companyName: "Firm", legalRecords: [{ title: "Business Licence", recordType: "BUSINESS_LICENSE", referenceNumber: "BL-1", status: "ACTIVE" }] as never, complianceRecords: [] });
    assert.doesNotMatch(md, /attached/i);
  });

  it("the team table claims neither an attached CV annex nor employment terms", () => {
    const md = buildProposedTeamTable([{ fullName: "A. Person", title: "Architect" } as ExpertRecord], "Lead");
    assert.doesNotMatch(md, /Appendix C|attached|permanent staff/i);
    assert.equal(buildProposedTeamTable([], "Lead"), "", "an empty team writes no bid-desk instruction");
  });
});

describe("an expert is mapped only to a project their own CV names", () => {
  const projects = [
    { name: "G+6 General Hospital – Dr Abdul Seid", sector: "Healthcare" },
    { name: "Dessie Specialized Hospital", sector: "Healthcare" },
    { name: "Hospital Project", sector: "Healthcare" },
  ] as ProjectRecord[];
  const experts = [
    { fullName: "S. Water", title: "Senior Sanitary Engineer", sectors: '["Healthcare"]', profile: "Lead sanitary engineer on the Dr Abdul Seid General Hospital." },
    { fullName: "E. Electric", title: "Senior Electrical Engineer", sectors: '["Healthcare"]', profile: "Electrical design for the Dessie Museum renovation." },
  ] as ExpertRecord[];

  it("names projects from a contiguous identifying phrase, never from scattered words or a generic name", () => {
    assert.deepEqual(projectsNamedInCv(experts[0].profile, projects).map((p) => p.name), ["G+6 General Hospital – Dr Abdul Seid"]);
    assert.deepEqual(projectsNamedInCv(experts[1].profile, projects), [], "Dessie Museum is not Dessie Specialized Hospital");
    assert.deepEqual(projectsNamedInCv("We design hospital projects.", projects), [], "a generic name ties to nothing");
  });

  it("reads software from the CV only", () => {
    assert.deepEqual(softwareNamedInCv("Tools: ETAP, DIALux and AutoCAD."), ["AutoCAD", "ETAP", "DIALux"]);
    assert.deepEqual(softwareNamedInCv(""), []);
  });

  it("the mapping table leaves out an expert whose CV names no selected project, and invents no role", () => {
    const md = buildTeamToProjectMappingTable(experts, projects);
    assert.match(md, /S\. Water/);
    assert.doesNotMatch(md, /E\. Electric/);
    assert.doesNotMatch(md, /Senior Senior/);
    assert.equal(buildTeamToProjectMappingTable([experts[1]], projects), "", "no row, no table");
  });
});

describe("the deterministic fallback writer", () => {
  const src = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("invents no years of experience", () => {
    assert.doesNotMatch(src, /yearsExperience \?\? 10/);
  });

  it("does not attribute the tender's sector to a person's years", () => {
    assert.doesNotMatch(src, /years of \$\{params\.primarySector\} experience/);
  });

  it("writes lead-in labels as text, not as contents entries", () => {
    assert.doesNotMatch(src, /"## Our response maps directly to the evaluation criteria:"/);
    assert.doesNotMatch(src, /"## Why we are best placed for this assignment:"/);
  });

  it("points at no appendix register the stripper removes", () => {
    assert.doesNotMatch(src, /listed in the Appendix Register/);
    assert.doesNotMatch(src, /senior bid-review controls/);
  });
});

describe("the value framework states method, not promised outcomes", () => {
  it("promises no revenue result and no approval outcome", async () => {
    const { buildValueFrameworkTable } = await import("../lib/engine/benchmark-tables");
    const md = buildValueFrameworkTable({ primarySector: "Healthcare / Medical Facility Design", clientName: "Client", sourceText: SILENT_TENDER });
    assert.doesNotMatch(md, /maximum revenue|from day one|exceeds .* requirements|shortening approval cycles/i);
    assert.match(md, /Regulatory Readiness/);
  });
});
