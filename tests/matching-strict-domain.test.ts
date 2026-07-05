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

const knowledge: CompanyKnowledgeSnapshot = {
  companyId: "c1",
  experts: [],
  projects: [
    {
      id: "p-warehouse",
      companyId: "c1",
      name: "Warehouse logistics optimization",
      clientName: "Logistics Corp",
      country: "ET",
      sector: "Logistics",
      summary: "Warehouse storage design and terminal flow optimization",
      serviceAreas: JSON.stringify(["warehouse", "logistics", "terminal"]),
      contractValue: 100000,
      currency: "USD",
      startDate: null,
      endDate: null,
      sourceDocumentId: null,
      trustLevel: "REVIEWED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "p-hospital",
      companyId: "c1",
      name: "Regional Hospital Design",
      clientName: "Health Bureau",
      country: "ET",
      sector: "Healthcare",
      summary: "Hospital master planning, medical wards, and patient flow",
      serviceAreas: JSON.stringify(["hospital", "healthcare", "medical"]),
      contractValue: 120000,
      currency: "USD",
      startDate: null,
      endDate: null,
      sourceDocumentId: null,
      trustLevel: "REVIEWED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  documents: [],
  legalRecords: [],
  financialRecords: [],
  complianceRecords: [],
};

describe("strict domain matching", () => {
  it("suppresses unrelated warehouse projects for healthcare tenders", () => {
    const result = buildMatches(requirements, knowledge, "Healthcare", "Hospital design services");
    const warehouse = result.projectMatches.find((m) => m.projectId === "p-warehouse");
    const hospital = result.projectMatches.find((m) => m.projectId === "p-hospital");
    assert.ok(warehouse);
    assert.ok(hospital);
    assert.equal(warehouse?.isSelected, false);
    assert.equal(hospital?.isSelected, true);
    assert.ok((hospital?.score ?? 0) > (warehouse?.score ?? 0));
  });
});
