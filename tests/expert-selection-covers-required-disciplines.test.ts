import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { buildMatches, capabilityFamilies } from "../lib/engine/matching";
import { buildReviewProvenance, expertReviewFields } from "../lib/vault-review-provenance";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";

// ─── What this file proves ───────────────────────────────────────────────────
//
// Two defects, both measured on a real hospital tender against a real
// 28-expert source-verified vault, both of which ended with an ARCHITECTURAL
// consultancy assignment proposing no architect.
//
// 1. THE TENDER'S OWN DISCIPLINE WORDS WERE INVISIBLE.
//    capabilityFamilies() knew ARCHITECTURE_BUILDINGS only from phrases like
//    "architectural design". So
//      "Architectural Consultancy Services for … Specialty Medical Center"
//    yielded only HEALTHCARE_FACILITIES, and the personnel requirement asking
//    for "a multidisciplinary group including architects, engineers, a
//    biomedical engineer, MEP experts" yielded only ELECTRO_MECHANICAL.
//    Architecture was therefore never a REQUIRED family, however loudly the
//    tender asked for it.
//
// 2. COVERAGE WAS ONLY EVER A TIE-BREAKER.
//    The portfolio optimizer's two coverage passes can only SWAP members of
//    the eligible pool, and that pool is pre-filtered to score >=
//    SELECTION_THRESHOLD (0.75). A discipline whose only carriers score below
//    that can never be covered, and because the passes preserve set size a
//    partially covered team is never extended. Measured: an electrical
//    engineer at 100% and the general manager at 77% were selected while both
//    architects sat at 74% and 73%.
//
// The completion pass admits a below-threshold candidate ONLY to cover a
// required family that nobody selected covers, only above the same 0.55 floor
// main-engine-selection-policy already uses for best-available authoritative
// evidence, and only within the existing limit. Provenance is untouched: an
// ineligible record scores 0 and is unreachable at any floor. Nothing is
// invented — a required family with no carrier in the vault stays uncovered,
// which the last test pins.

// Durable provenance, built the same way the production verifier builds it —
// an ineligible record scores 0, so a fixture without it would prove nothing
// about selection.
function expert(id: string, fullName: string, title: string, disciplines: string[], profile: string) {
  const companyId = "company-1";
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  // Durable provenance binds every reviewed field to bytes in the source, so
  // the fixture's source text must actually state them.
  const sourceText = [
    fullName,
    title,
    "12 years of experience",
    ...disciplines,
    "Healthcare",
    profile,
  ].join(". ");
  const sourceDocument = {
    id: `doc-${id}`,
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id,
    companyId,
    fullName,
    title,
    email: null,
    phone: null,
    yearsExperience: 12,
    disciplines: JSON.stringify(disciplines),
    sectors: JSON.stringify(["Healthcare"]),
    certifications: JSON.stringify([]),
    profile,
    isActive: true,
    trustLevel: "REVIEWED",
    reviewedBy: "reviewer-1",
    reviewedAt,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    deletedBy: null,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  if (!provenance.ok) throw new Error(`fixture provenance failed for ${fullName}`);
  return { ...record, reviewNotes: provenance.serialized };
}

const REQUIREMENTS: RequirementDraft[] = [
  {
    title: "Proposed Professional Team & Expertise",
    description: "Submit details of the proposed professional team, ensuring the availability of a multidisciplinary group including architects, engineers, a biomedical engineer, MEP experts, and other relevant specialists.",
    requirementType: "EXPERT",
    priority: "SCORED",
  },
  {
    title: "Technical Approach and Methodology",
    description: "Detail the technical approach for a specialty medical center, covering concept design, detailed design and MEP coordination for the hospital.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
  },
];

function knowledgeWith(experts: ReturnType<typeof expert>[]): CompanyKnowledgeSnapshot {
  return {
    companyId: "company-1",
    experts: experts as CompanyKnowledgeSnapshot["experts"],
    projects: [] as CompanyKnowledgeSnapshot["projects"],
    documents: [],
    legalRecords: [] as CompanyKnowledgeSnapshot["legalRecords"],
    financialRecords: [] as CompanyKnowledgeSnapshot["financialRecords"],
    complianceRecords: [] as CompanyKnowledgeSnapshot["complianceRecords"],
  };
}

describe("the tender's own discipline words are read as required families", () => {
  it("reads the role noun a tender actually uses", () => {
    assert.ok(
      capabilityFamilies("a multidisciplinary group including architects, engineers, a biomedical engineer, MEP experts").includes("ARCHITECTURE_BUILDINGS"),
      "a requirement naming architects did not require architecture",
    );
    assert.ok(
      capabilityFamilies("Architectural Consultancy Services for a Specialty Medical Center").includes("ARCHITECTURE_BUILDINGS"),
      "an architectural consultancy title did not require architecture",
    );
    assert.ok(
      capabilityFamilies("Senior Structural Engineer").includes("CIVIL_INFRASTRUCTURE"),
      "a structural engineer carried no civil/structural family",
    );
    // "mechanical, electrical, plumbing" is MEP, one building-services
    // discipline, and ELECTRO_MECHANICAL is the family that carries it. Making
    // "plumbing" additionally require WATER_SUPPLY was tried and backed out:
    // it made a hospital tender require a water family its own hospital
    // records do not carry, dropping genuine hospital evidence below the
    // comparable-experience bar (tests/evidence-relevance-ranking.test.ts).
    assert.ok(
      capabilityFamilies("The consultant shall coordinate mechanical, electrical, plumbing, medical gas and healthcare facility engineering systems.").includes("ELECTRO_MECHANICAL"),
      "a tender naming MEP coordination required no electro-mechanical capability",
    );
    assert.ok(
      !capabilityFamilies("The consultant shall coordinate mechanical, electrical, plumbing, medical gas and healthcare facility engineering systems.").includes("WATER_SUPPLY"),
      "an MEP coordination sentence was read as a water-infrastructure requirement",
    );
  });

  it("does not fire on a firm's name that merely contains the adjective", () => {
    // The earlier tightening that moved /building/, /residential/ and /housing/
    // out of this family must not be undone: nearly every consultancy in this
    // market is called "… Architectural and Engineering Consultancy", and if
    // that name alone conferred the family it would stop discriminating.
    assert.ok(
      !capabilityFamilies("Hope Urban Planning Architectural and Engineering Consultancy PLC").includes("ARCHITECTURE_BUILDINGS"),
      "a firm name alone conferred the architecture family",
    );
  });
});

describe("a required discipline is covered even when its carrier is below the auto-select threshold", () => {
  const experts = [
    // Scores highest: matches the MEP + hospital vocabulary the tender repeats.
    expert("e-mep", "M. Electrical", "Senior Electrical Engineer",
      ["Electrical Engineering", "Mechanical Engineering"],
      "MEP coordination for hospital projects, medical gas, HVAC and electrical design for specialty medical centers and clinics."),
    // The only architect. Real but lexically thinner, so it lands below 0.75.
    expert("e-arch", "A. Architect", "Architect",
      ["Architecture"],
      "Architect responsible for concept and detailed design of buildings."),
  ];

  const result = buildMatches(REQUIREMENTS, knowledgeWith(experts), "Healthcare / Medical Facility Design", "Architectural Consultancy Services for a Specialty Medical Center");
  const selected = result.expertMatches.filter((m) => m.isSelected);
  const selectedIds = new Set(selected.map((m) => m.expertId));

  it("selects the architect the tender asks for", () => {
    assert.ok(selectedIds.has("e-arch"), `the only architect was not selected: ${JSON.stringify(result.expertMatches.map((m) => [m.expertId, m.score]))}`);
  });

  it("still selects on merit where merit exists", () => {
    assert.ok(selectedIds.has("e-mep"), "the strongest candidate was dropped");
  });

  it("never reaches below the best-available floor", () => {
    for (const match of selected) {
      assert.ok(match.score >= 0.55, `a candidate below the 0.55 floor was selected at ${match.score}`);
    }
  });
});

describe("coverage completion invents nobody", () => {
  it("leaves a required discipline uncovered when the vault has no carrier", () => {
    // The real vault holds no biomedical engineer. The correct outcome is a
    // reported gap, never a fabricated person.
    const experts = [
      expert("e-arch", "A. Architect", "Architect", ["Architecture"], "Architect for concept and detailed design of buildings."),
    ];
    const result = buildMatches(REQUIREMENTS, knowledgeWith(experts), "Healthcare / Medical Facility Design", "Architectural Consultancy Services for a Specialty Medical Center");
    const selected = result.expertMatches.filter((m) => m.isSelected);

    assert.ok(selected.length <= experts.length, "more experts were selected than exist");
    for (const match of selected) {
      assert.ok(experts.some((e) => e.id === match.expertId), "a selected expert is not in the vault");
    }
    const names = selected.map((m) => experts.find((e) => e.id === m.expertId)?.fullName ?? "");
    assert.ok(!names.some((n) => /biomedical/i.test(n)), "a biomedical expert was conjured");
  });

  it("selects nobody at all when no candidate carries any required family", () => {
    const experts = [
      expert("e-off", "L. Logistics", "Warehouse logistics coordinator", ["Warehouse logistics"], "Freight yard inventory and depot scheduling."),
    ];
    const result = buildMatches(REQUIREMENTS, knowledgeWith(experts), "Healthcare / Medical Facility Design", "Architectural Consultancy Services for a Specialty Medical Center");
    assert.equal(result.expertMatches.filter((m) => m.isSelected).length, 0);
  });
});
