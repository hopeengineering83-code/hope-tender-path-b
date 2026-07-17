import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";

const requirements: RequirementDraft[] = [
  {
    title: "Healthcare project experience",
    description: "Provide at least 2 similar hospital or healthcare facility projects.",
    requirementType: "PROJECT_EXPERIENCE",
    priority: "MANDATORY",
  },
];

function reviewedProject(overrides: Partial<CompanyKnowledgeSnapshot["projects"][number]> & Pick<CompanyKnowledgeSnapshot["projects"][number], "id" | "name" | "sector" | "summary">): CompanyKnowledgeSnapshot["projects"][number] {
  return {
    companyId: "c1",
    clientName: "Client",
    country: "ET",
    serviceAreas: JSON.stringify([]),
    contractValue: 100000,
    currency: "USD",
    startDate: null,
    endDate: null,
    sourceDocumentId: `source-${overrides.id}`,
    trustLevel: "REVIEWED",
    reviewedBy: "reviewer-1",
    reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
    reviewNotes: "Reviewed against durable source evidence.",
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const knowledge: CompanyKnowledgeSnapshot = {
  companyId: "c1",
  experts: [],
  projects: [
    reviewedProject({
      id: "p-warehouse",
      name: "Warehouse logistics optimization",
      clientName: "Logistics Corp",
      sector: "Logistics",
      summary: "Warehouse storage design and terminal flow optimization",
      serviceAreas: JSON.stringify(["warehouse", "logistics", "terminal"]),
    }),
    reviewedProject({
      id: "p-hospital",
      name: "Regional Hospital Design",
      clientName: "Health Bureau",
      sector: "Healthcare",
      summary: "Hospital master planning, medical wards, and patient flow",
      serviceAreas: JSON.stringify(["hospital", "healthcare", "medical"]),
    }),
  ],
  documents: [],
  legalRecords: [],
  financialRecords: [],
  complianceRecords: [],
};

describe("strict domain matching", () => {
  it("suppresses unrelated warehouse projects for healthcare tenders", () => {
    const result = buildMatches(requirements, knowledge, "Healthcare", "Hospital design services");
    const warehouse = result.projectMatches.find((match) => match.projectId === "p-warehouse");
    const hospital = result.projectMatches.find((match) => match.projectId === "p-hospital");
    assert.ok(warehouse);
    assert.ok(hospital);
    assert.equal(warehouse?.isSelected, false);
    assert.equal(hospital?.isSelected, true);
    assert.ok((hospital?.score ?? 0) > (warehouse?.score ?? 0));
  });

  it("keeps source-less records at zero even when their sector text matches", () => {
    const ungrounded = reviewedProject({
      id: "p-ungrounded-hospital",
      name: "Hospital Project",
      sector: "Healthcare",
      summary: "Hospital wards and patient flow",
      sourceDocumentId: null,
    });
    const result = buildMatches(requirements, {
      ...knowledge,
      projects: [ungrounded],
    }, "Healthcare", "Hospital design services");
    assert.equal(result.projectMatches[0]?.score, 0);
    assert.equal(result.projectMatches[0]?.isSelected, false);
  });
});
