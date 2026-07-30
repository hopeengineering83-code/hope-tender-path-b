/**
 * Regression tests for the matching relevance gates.
 *
 * These tests guard against false-positive patterns while respecting the
 * current durable-provenance requirement: a REVIEWED record is usable only
 * when it carries source-document and reviewer evidence.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";
import { buildReviewProvenance, expertReviewFields, projectReviewFields } from "../lib/vault-review-provenance";

const REVIEWED_AT = new Date("2026-07-01T00:00:00.000Z");
const REVIEWER_ID = "reviewer-1";

function verifiedSource(id: string, text: string) {
  return {
    id: `source-${id}`,
    companyId: "c1",
    extractedText: text,
    contentSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
  };
}

function makeProject(
  id: string,
  name: string,
  sector: string,
  summary: string,
  serviceAreas: string[],
): CompanyKnowledgeSnapshot["projects"][number] {
  const base = {
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
    trustLevel: "REVIEWED",
    reviewedBy: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sourceText = `Project ${name}. Client Client. Country ET. Sector ${sector}. Service areas ${serviceAreas.join(", ")}. Contract value 150000. Currency USD. This verified project reference contains complete source evidence for matching review.`;
  const sourceDocument = verifiedSource(id, sourceText);
  const provenance = buildReviewProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(base),
    reviewerId: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("project fixture provenance failed");
  return {
    ...base,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    reviewNotes: provenance.serialized,
  } as unknown as CompanyKnowledgeSnapshot["projects"][number];
}

function makeExpert(
  id: string,
  fullName: string,
  title: string,
  profile: string,
  disciplines: string[],
  sectors: string[],
): CompanyKnowledgeSnapshot["experts"][number] {
  const base = {
    id,
    companyId: "c1",
    fullName,
    title,
    email: null,
    phone: null,
    profile,
    disciplines: JSON.stringify(disciplines),
    sectors: JSON.stringify(sectors),
    certifications: JSON.stringify([]),
    yearsExperience: 12,
    isActive: true,
    trustLevel: "REVIEWED",
    reviewedBy: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sourceText = `Expert ${fullName}. Title ${title}. Years experience 12. Disciplines ${disciplines.join(", ")}. Sectors ${sectors.join(", ")}. This verified curriculum vitae contains complete source evidence for matching review.`;
  const sourceDocument = verifiedSource(id, sourceText);
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(base),
    reviewerId: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("expert fixture provenance failed");
  return {
    ...base,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    reviewNotes: provenance.serialized,
  } as unknown as CompanyKnowledgeSnapshot["experts"][number];
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

describe("matching relevance gates — water supply tender", () => {
  it("does NOT select a logistics/warehouse project for a water supply tender", () => {
    const knowledge: CompanyKnowledgeSnapshot = {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [],
      projects: [
        makeProject("p-water", "Rural Water Supply — Borehole Drilling", "Water Supply", "Hydrogeological survey, borehole drilling, pump installation, WASH sanitation for 3 woredas.", ["water supply", "borehole", "hydraulic", "WASH", "sanitation"]),
        makeProject("p-logistics", "Warehouse Storage Optimisation", "Logistics", "Warehouse layout design and terminal flow optimisation for dry goods storage.", ["warehouse", "logistics", "terminal", "storage"]),
        makeProject("p-road", "Rural Road Rehabilitation", "Road Construction", "Gravel road rehabilitation, drainage structures, bridge construction supervision.", ["road", "bridge", "drainage", "pavement"]),
      ],
    };

    const result = buildMatches(waterRequirements, knowledge, "Water Supply", "Rural borehole water supply scheme");
    const water = result.projectMatches.find((match) => match.projectId === "p-water");
    const logistics = result.projectMatches.find((match) => match.projectId === "p-logistics");
    const road = result.projectMatches.find((match) => match.projectId === "p-road");

    assert.ok(water);
    assert.ok(logistics);
    assert.ok(road);
    assert.equal(water?.isSelected, true);
    assert.equal(logistics?.isSelected, false);
    assert.ok((water?.score ?? 0) > (logistics?.score ?? 0));
    assert.ok((water?.score ?? 0) > (road?.score ?? 0));
  });

  it("does NOT select a logistics expert for a water supply tender", () => {
    const knowledge: CompanyKnowledgeSnapshot = {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [
        makeExpert("e-hydraulic", "Dr. Tadesse Bekele", "Senior Hydraulic Engineer", "20 years borehole drilling, water supply feasibility, hydraulic design, WASH programs.", ["Hydraulic Engineering", "Water Supply Design", "WASH"], ["Water Supply", "Sanitation"]),
        makeExpert("e-logistics", "Abebe Girma", "Logistics Manager", "Supply chain management, warehouse operations, inventory control, logistics planning.", ["Supply Chain Management", "Warehouse Management", "Logistics Planning"], ["Logistics", "Supply Chain"]),
        makeExpert("e-pm", "Mekdes Alemu", "Project Manager", "Project management, strategic planning, stakeholder reporting, team leadership.", ["Project Management", "Strategic Planning"], ["General Consulting"]),
      ],
      projects: [],
    };

    const result = buildMatches(waterRequirements, knowledge, "Water Supply", "Rural borehole water supply");
    const hydraulic = result.expertMatches.find((match) => match.expertId === "e-hydraulic");
    const logistics = result.expertMatches.find((match) => match.expertId === "e-logistics");
    const pm = result.expertMatches.find((match) => match.expertId === "e-pm");

    assert.ok(hydraulic);
    assert.ok(logistics);
    assert.ok((hydraulic?.score ?? 0) > (logistics?.score ?? 0));
    assert.equal(logistics?.isSelected, false);
    if (pm) assert.ok((hydraulic?.score ?? 0) > (pm.score ?? 0));
  });

  it("all-off-sector portfolio remains unselected", () => {
    const knowledge: CompanyKnowledgeSnapshot = {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [],
      projects: [
        makeProject("p-logistics", "Container Terminal Logistics", "Logistics", "Port logistics, container handling, warehouse storage and terminal management.", ["logistics", "warehouse", "terminal", "port"]),
        makeProject("p-manufacturing", "Textile Factory Setup", "Manufacturing", "Industrial factory establishment, production line setup, manufacturing quality control.", ["manufacturing", "factory", "industrial"]),
      ],
    };

    const result = buildMatches(waterRequirements, knowledge, "Water Supply", "Water borehole scheme");
    assert.equal(result.projectMatches.filter((match) => match.isSelected).length, 0);
  });

  it("rejects source-less records before relevance scoring", () => {
    const ungrounded = makeProject("p-ungrounded", "Water Project", "Water Supply", "Borehole and WASH", ["water"]);
    ungrounded.sourceDocumentId = null;
    const result = buildMatches(waterRequirements, {
      ...emptyKnowledgeBase,
      companyId: "c1",
      experts: [],
      projects: [ungrounded],
    }, "Water Supply", "Borehole water supply");
    assert.equal(result.projectMatches.length, 0);
  });
});
