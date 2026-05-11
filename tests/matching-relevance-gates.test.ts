/**
 * Regression tests for the matching relevance gates.
 *
 * These tests guard against the most common false-positive patterns:
 *   1. Logistics / warehouse projects selected for a water-supply tender
 *   2. Road-construction projects selected for a water-supply tender
 *   3. Generic "design" / "planning" vocabulary inflating unrelated scores
 *   4. Near-zero-capability items bypassing the capability relevance gate
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeProject(
  id: string,
  name: string,
  sector: string,
  summary: string,
  serviceAreas: string[],
): CompanyKnowledgeSnapshot["projects"][number] {
  return {
    id,
    companyId: "c1",
    name,
    clientName: "Client",
    country: "ET",
    sector,
    summary,
    serviceAreas: JSON.stringify(serviceAreas),
    contractValue: 150000,
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
  };
}

function makeExpert(
  id: string,
  fullName: string,
  title: string,
  profile: string,
  disciplines: string[],
  sectors: string[],
): CompanyKnowledgeSnapshot["experts"][number] {
  return {
    id,
    companyId: "c1",
    fullName,
    title,
    profile,
    disciplines: JSON.stringify(disciplines),
    sectors: JSON.stringify(sectors),
    certifications: JSON.stringify([]),
    yearsExperience: 12,
    trustLevel: "REVIEWED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const emptyKnowledgeBase: Pick<
  CompanyKnowledgeSnapshot,
  "documents" | "legalRecords" | "financialRecords" | "complianceRecords"
> = {
  documents: [],
  legalRecords: [],
  financialRecords: [],
  complianceRecords: [],
};

// ─── water supply tender requirements (realistic) ───────────────────────────

const waterRequirements: RequirementDraft[] = [
  {
    title: "Borehole drilling and pump installation",
    description: "Design and supervision of borehole drilling, pump selection and installation for rural water supply.",
    requirementType: "PROJECT_EXPERIENCE",
    priority: "MANDATORY",
  },
  {
    title: "Hydraulic engineer",
    description: "Senior hydraulic engineer with experience in water supply feasibility studies and detailed design.",
    requirementType: "EXPERT",
    priority: "MANDATORY",
  },
  {
    title: "WASH and sanitation experience",
    description: "Previous WASH projects in rural kebeles including sanitation and latrine construction.",
    requirementType: "PROJECT_EXPERIENCE",
    priority: "SCORED",
  },
  {
    title: "Geotechnical investigation",
    description: "Soil investigation and hydrogeological survey for borehole site selection.",
    requirementType: "EXPERT",
    priority: "SCORED",
  },
];

// ─── TEST 1: logistics/warehouse vs water-supply ─────────────────────────────

describe("matching relevance gates — water supply tender", () => {
  it("does NOT select a logistics/warehouse project for a water supply tender", () => {
    const knowledge: CompanyKnowledgeSnapshot = {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [],
      projects: [
        makeProject(
          "p-water",
          "Rural Water Supply — Borehole Drilling",
          "Water Supply",
          "Hydrogeological survey, borehole drilling, pump installation, WASH sanitation for 3 woredas.",
          ["water supply", "borehole", "hydraulic", "WASH", "sanitation"],
        ),
        makeProject(
          "p-logistics",
          "Warehouse Storage Optimisation",
          "Logistics",
          "Warehouse layout design and terminal flow optimisation for dry goods storage.",
          ["warehouse", "logistics", "terminal", "storage"],
        ),
        makeProject(
          "p-road",
          "Rural Road Rehabilitation",
          "Road Construction",
          "Gravel road rehabilitation, drainage structures, bridge construction supervision.",
          ["road", "bridge", "drainage", "pavement"],
        ),
      ],
    };

    const result = buildMatches(waterRequirements, knowledge, "Water Supply", "Rural borehole water supply scheme");

    const water = result.projectMatches.find((m) => m.projectId === "p-water");
    const logistics = result.projectMatches.find((m) => m.projectId === "p-logistics");
    const road = result.projectMatches.find((m) => m.projectId === "p-road");

    assert.ok(water, "water project should be in results");
    assert.ok(logistics, "logistics project should be in results");
    assert.ok(road, "road project should be in results");

    // Water project must score highest and be selected.
    assert.equal(water?.isSelected, true, "water project should be selected");

    // Logistics project should NOT be selected — pure logistics with sector conflict.
    assert.equal(logistics?.isSelected, false, "logistics project must NOT be selected for water tender");

    // Water project must outscore both off-sector alternatives.
    assert.ok(
      (water?.score ?? 0) > (logistics?.score ?? 0),
      `water (${water?.score?.toFixed(3)}) should outscore logistics (${logistics?.score?.toFixed(3)})`,
    );
    assert.ok(
      (water?.score ?? 0) > (road?.score ?? 0),
      `water (${water?.score?.toFixed(3)}) should outscore road (${road?.score?.toFixed(3)})`,
    );
  });

  it("does NOT select a logistics expert for a water supply tender", () => {
    const knowledge: CompanyKnowledgeSnapshot = {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [
        makeExpert(
          "e-hydraulic",
          "Dr. Tadesse Bekele",
          "Senior Hydraulic Engineer",
          "20 years borehole drilling, water supply feasibility, hydraulic design, WASH programs.",
          ["Hydraulic Engineering", "Water Supply Design", "WASH"],
          ["Water Supply", "Sanitation"],
        ),
        makeExpert(
          "e-logistics",
          "Abebe Girma",
          "Logistics Manager",
          "Supply chain management, warehouse operations, inventory control, logistics planning.",
          ["Supply Chain Management", "Warehouse Management", "Logistics Planning"],
          ["Logistics", "Supply Chain"],
        ),
        makeExpert(
          "e-pm",
          "Mekdes Alemu",
          "Project Manager",
          "Project management, strategic planning, stakeholder reporting, team leadership.",
          ["Project Management", "Strategic Planning"],
          ["General Consulting"],
        ),
      ],
      projects: [],
    };

    const result = buildMatches(waterRequirements, knowledge, "Water Supply", "Rural borehole water supply");

    const hydraulic = result.expertMatches.find((m) => m.expertId === "e-hydraulic");
    const logistics = result.expertMatches.find((m) => m.expertId === "e-logistics");
    const pm = result.expertMatches.find((m) => m.expertId === "e-pm");

    assert.ok(hydraulic, "hydraulic expert should be in results");
    assert.ok(logistics, "logistics expert should be in results");

    // Hydraulic expert must score significantly higher than logistics.
    assert.ok(
      (hydraulic?.score ?? 0) > (logistics?.score ?? 0),
      `hydraulic (${hydraulic?.score?.toFixed(3)}) must outscore logistics (${logistics?.score?.toFixed(3)})`,
    );

    // Logistics expert — no water-related capability — should NOT be selected.
    assert.equal(logistics?.isSelected, false, "logistics expert must NOT be selected for water tender");

    // Generic PM expert with "planning" / "reporting" in profile should not
    // be selected when a domain-matched expert exists.
    if (pm) {
      assert.ok(
        (hydraulic?.score ?? 0) > (pm?.score ?? 0),
        `hydraulic (${hydraulic?.score?.toFixed(3)}) must outscore generic PM (${pm?.score?.toFixed(3)})`,
      );
    }
  });

  it("all-off-sector portfolio: floor guarantee does not force logistics above 0.55", () => {
    // When a company has ONLY logistics/road projects, the floor guarantee
    // must not force-select projects scoring below 0.55.
    const knowledge: CompanyKnowledgeSnapshot = {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [],
      projects: [
        makeProject(
          "p-logistics",
          "Container Terminal Logistics",
          "Logistics",
          "Port logistics, container handling, warehouse storage and terminal management.",
          ["logistics", "warehouse", "terminal", "port"],
        ),
        makeProject(
          "p-manufacturing",
          "Textile Factory Setup",
          "Manufacturing",
          "Industrial factory establishment, production line setup, manufacturing quality control.",
          ["manufacturing", "factory", "industrial"],
        ),
      ],
    };

    const result = buildMatches(waterRequirements, knowledge, "Water Supply", "Water borehole scheme");

    // With only off-sector projects, none should be selected by floor guarantee.
    const allSelected = result.projectMatches.filter((m) => m.isSelected);

    for (const m of allSelected) {
      assert.ok(
        m.score >= 0.55,
        `Floor-promoted project must score ≥ 0.55, got ${m.score.toFixed(3)} for project ${m.projectId}`,
      );
    }
  });
});
