// A list of named roles is a floor under the team, not the team size.
//
// Measured on the Preview (2026-09-24, inspection run 36041511483): a hospital
// tender asking for "a multidisciplinary professional team: architects,
// engineers, biomedical engineer, MEP experts, and other relevant specialists"
// against a vault of 28 source-verified experts, 18 of them scoring 100%,
// fielded THREE people — and none of the three was an architect, on an
// architectural consultancy assignment.
//
// Two causes, both fixed here:
//
// 1. deriveRequirementConstraintProfile counted the role families the tender
//    names (architect, biomedical, MEP = 3) and selectedLimit used that count
//    as the exact team size. A stated head count ("minimum 3 key experts") is
//    still exact; named roles are now only a floor under the default size.
//
// 2. Selection never looked at the roles. Capability families and discipline
//    tags are read from whole CVs and from tags the firm copies onto every
//    record, so they cannot tell the architect from the highway engineer. Each
//    person's own title now says which named role they hold, and the optimizer
//    covers each named role before adding depth.
//
// Nothing is invented: a role nobody in the vault holds (here, biomedical)
// stays uncovered and is reported downstream.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { buildMatches } from "../lib/engine/matching";
import { deriveRequirementConstraintProfile, expertTitleRoles } from "../lib/engine/requirement-constraints";
import { buildReviewProvenance, expertReviewFields } from "../lib/vault-review-provenance";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";

// Durable provenance, built the way the production verifier builds it; an
// ineligible record scores 0 and would prove nothing about selection.
function expert(id: string, fullName: string, title: string) {
  const companyId = "company-1";
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  // Every record carries the same boilerplate tags, as the real vault does.
  const disciplines = ["Architecture", "Urban Planning", "Electrical Engineering", "Structural Engineering"];
  const profile = `${title} with hospital and healthcare facility design and supervision experience, including specialty medical centers and clinics.`;
  const sourceText = [fullName, title, "12 years of experience", ...disciplines, "Healthcare", profile].join(". ");
  const sourceDocument = {
    id: `doc-${id}`,
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id, companyId, fullName, title, email: null, phone: null, yearsExperience: 12,
    disciplines: JSON.stringify(disciplines),
    sectors: JSON.stringify(["Healthcare"]),
    certifications: JSON.stringify([]),
    profile, isActive: true, trustLevel: "REVIEWED", reviewedBy: "reviewer-1", reviewedAt,
    sourceDocumentId: sourceDocument.id, sourceDocument,
    createdAt: reviewedAt, updatedAt: reviewedAt, deletedAt: null, deletedBy: null,
  };
  const provenance = buildReviewProvenance({ recordType: "EXPERT", sourceDocument, fields: expertReviewFields(record), reviewerId: record.reviewedBy, reviewedAt });
  if (!provenance.ok) throw new Error(`fixture provenance failed for ${fullName}`);
  return { ...record, reviewNotes: provenance.serialized };
}

const EXPERTS = [
  expert("pm", "P. Manager", "Project Manager / Senior Civil Engineer"),
  expert("hw1", "H. One", "Senior Highway Engineer"),
  expert("hw2", "H. Two", "Senior Highway Engineer"),
  expert("geo", "G. Soil", "Senior Geotechnical Engineer"),
  expert("arch1", "A. One", "Senior Architect"),
  expert("arch2", "A. Two", "Architect"),
  expert("el1", "E. One", "Senior Electrical Engineer"),
  expert("el2", "E. Two", "Electrical Engineer"),
  expert("san1", "S. One", "Senior Sanitary Engineer"),
  expert("san2", "S. Two", "Sanitary Engineer"),
  expert("str", "S. Frame", "Senior Structural Engineer"),
];

function knowledge(): CompanyKnowledgeSnapshot {
  return {
    companyId: "company-1",
    experts: EXPERTS as unknown as CompanyKnowledgeSnapshot["experts"],
    projects: [] as CompanyKnowledgeSnapshot["projects"],
    documents: [],
    legalRecords: [] as CompanyKnowledgeSnapshot["legalRecords"],
    financialRecords: [] as CompanyKnowledgeSnapshot["financialRecords"],
    complianceRecords: [] as CompanyKnowledgeSnapshot["complianceRecords"],
  };
}

const NAMED_ROLES_NO_COUNT: RequirementDraft[] = [
  {
    title: "Multidisciplinary Professional Team",
    description: "Availability of a multidisciplinary professional team: architects, engineers, biomedical engineer, MEP experts, and other relevant specialists for the hospital.",
    requirementType: "EXPERT",
    priority: "MANDATORY",
  },
  {
    title: "Technical Approach and Methodology",
    description: "Concept and detailed design of the specialty medical center and coordination of mechanical, electrical and plumbing systems for the hospital.",
    requirementType: "METHODOLOGY",
    priority: "MANDATORY",
  },
];

const SECTOR = "Healthcare";
const TITLE = "Architectural Consultancy Services for a Specialty Medical Center";

function selectedTitles(requirements: RequirementDraft[]): string[] {
  const result = buildMatches(requirements, knowledge(), SECTOR, TITLE);
  return result.expertMatches
    .filter((m) => m.isSelected)
    .map((m) => EXPERTS.find((e) => e.id === m.expertId)!.title);
}

describe("the constraint profile separates a stated count from named roles", () => {
  it("names roles without inventing a head count", () => {
    const profile = deriveRequirementConstraintProfile(NAMED_ROLES_NO_COUNT);
    assert.equal(profile.explicitExpertCount, 0, "no number was stated");
    for (const role of ["architect", "biomedical", "electrical", "mechanical", "plumbing"]) {
      assert.ok(profile.roleSignals.includes(role), `${role} not read from the tender: ${profile.roleSignals}`);
    }
    assert.ok(profile.expertCount >= profile.roleSignals.length, "the floor is at least one person per named role");
  });

  it("keeps a stated count as the explicit count", () => {
    const profile = deriveRequirementConstraintProfile([
      { ...NAMED_ROLES_NO_COUNT[0], description: "Provide a minimum of 3 key experts: an architect, an electrical engineer and a sanitary engineer." },
    ]);
    assert.equal(profile.explicitExpertCount, 3);
  });

  it("reads a person's role from the title, and MEP as three disciplines", () => {
    assert.deepEqual(expertTitleRoles("Senior Sanitary Engineer"), ["plumbing"]);
    assert.deepEqual(expertTitleRoles("Senior Electrical Engineer"), ["electrical"]);
    assert.ok(expertTitleRoles("Senior Architect & Urban Planner").includes("architect"));
    assert.ok(expertTitleRoles("Project Manager / Senior Civil Engineer").includes("team_leader"));
    assert.deepEqual(expertTitleRoles("Senior Highway Engineer"), []);
    assert.deepEqual(expertTitleRoles(null), []);
  });
});

describe("a tender that names roles but states no count", () => {
  const titles = selectedTitles(NAMED_ROLES_NO_COUNT);

  it("is not capped at the number of role families it names", () => {
    const roleFamilies = deriveRequirementConstraintProfile(NAMED_ROLES_NO_COUNT).roleSignals.length;
    assert.ok(titles.length > 3, `only ${titles.length} selected: ${titles}`);
    assert.ok(titles.length >= Math.min(roleFamilies, EXPERTS.length) - 2, `team smaller than the named roles it can fill: ${titles}`);
  });

  it("fields the architect, electrical, plumbing and lead roles from the people who hold them", () => {
    assert.ok(titles.some((t) => /architect/i.test(t)), `no architect: ${titles}`);
    assert.ok(titles.some((t) => /electrical/i.test(t)), `no electrical engineer: ${titles}`);
    assert.ok(titles.some((t) => /sanitary/i.test(t)), `no plumbing (sanitary) engineer: ${titles}`);
    assert.ok(titles.some((t) => /project manager/i.test(t)), `no lead: ${titles}`);
  });

  it("chooses every holder of a named role before anyone whose title holds none", () => {
    const roleHolders = EXPERTS.filter((e) => expertTitleRoles(e.title).length > 0).map((e) => e.title);
    const nonHolderSelected = titles.filter((t) => expertTitleRoles(t).length === 0);
    if (nonHolderSelected.length > 0) {
      for (const holder of roleHolders) {
        assert.ok(titles.includes(holder), `${nonHolderSelected} selected while ${holder} was left out`);
      }
    }
    assert.ok(!titles.includes("Senior Highway Engineer") || roleHolders.every((h) => titles.includes(h)));
  });

  it("invents nobody: the biomedical role nobody holds stays empty", () => {
    assert.ok(titles.every((t) => EXPERTS.some((e) => e.title === t)));
    assert.ok(!titles.some((t) => /biomedical/i.test(t)));
  });
});

describe("a stated head count stays exact", () => {
  it("selects exactly the stated number, spread across the named roles", () => {
    const titles = selectedTitles([
      { ...NAMED_ROLES_NO_COUNT[0], description: "Provide a minimum of 3 key experts for the hospital: an architect, an electrical engineer and a sanitary engineer." },
      NAMED_ROLES_NO_COUNT[1],
    ]);
    assert.equal(titles.length, 3, `${titles}`);
    assert.ok(titles.some((t) => /architect/i.test(t)), `no architect among three: ${titles}`);
  });
});
