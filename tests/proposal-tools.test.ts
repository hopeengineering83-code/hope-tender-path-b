// Unit tests for proposal-tools (gap #10 — tool-use during generation).
// Pure-function coverage of the tool executor + tool definitions.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  executeProposalTool,
  searchCompanyKnowledge,
  PROPOSAL_TOOL_DEFS,
  type ToolEvidenceInventory,
} from "../lib/engine/generation/proposal-tools";

function inventory(): ToolEvidenceInventory {
  return {
    experts: [
      {
        fullName: "Dr. Alemu Tadesse",
        title: "Senior Hydraulic Engineer",
        yearsExperience: 18,
        disciplines: ["water supply", "hydraulic modelling"],
        sectors: ["water", "WASH"],
        certifications: ["PE License Grade I"],
        profile: "18 years of experience in EPANET-based hydraulic modelling for urban water supply schemes. Lead engineer on 2022 Sebeta WASH project (ETB 18M, World Bank).",
        trustLevel: "REVIEWED",
      },
      {
        fullName: "Mr. Bekele Bogale",
        title: "Project Manager",
        yearsExperience: 12,
        disciplines: ["project management"],
        sectors: ["urban infrastructure"],
        certifications: ["PMP"],
        profile: "PMP-certified project manager with 12 years overseeing donor-funded infrastructure assignments.",
        trustLevel: "REVIEWED",
      },
    ],
    projects: [
      {
        name: "Sebeta WASH Feasibility and Detailed Design",
        clientName: "Ethiopian Ministry of Water",
        country: "Ethiopia",
        sector: "water",
        serviceAreas: "feasibility, hydraulic design, supervision",
        summary: "World Bank-funded WASH project covering hydraulic design, EPANET modelling, and detailed engineering drawings for 12 woredas.",
        contractValue: 18_000_000,
        currency: "ETB",
        startDate: "2022-01-15",
        endDate: "2023-06-30",
        trustLevel: "REVIEWED",
      },
      {
        name: "Adama Urban Master Plan",
        clientName: "Adama City Administration",
        country: "Ethiopia",
        sector: "urban planning",
        serviceAreas: "master planning, zoning",
        summary: "Urban master plan and zoning study for Adama covering land use, transport, and infrastructure.",
        contractValue: 24_000_000,
        currency: "ETB",
        startDate: "2020-03-01",
        endDate: "2021-12-31",
        trustLevel: "REVIEWED",
      },
    ],
  };
}

describe("PROPOSAL_TOOL_DEFS", () => {
  it("declares six tools with valid schemas (round 10 adds tender-requirement lookup)", () => {
    assert.equal(PROPOSAL_TOOL_DEFS.length, 6);
    const names = PROPOSAL_TOOL_DEFS.map((t) => t.name).sort();
    assert.deepEqual(names, ["inspect_company_profile", "inspect_expert", "inspect_project", "inspect_tender_requirement", "lookup_legal_record", "search_company_knowledge"]);
    for (const def of PROPOSAL_TOOL_DEFS) {
      assert.ok(def.description.length > 30, `tool ${def.name} needs a substantive description`);
      assert.equal(def.input_schema.type, "object");
      // inspect_company_profile takes no arguments — required[] may be empty
      assert.ok(Array.isArray(def.input_schema.required), `tool ${def.name} missing required[] array`);
    }
  });
});

describe("executeProposalTool — inspect_tender_requirement", () => {
  function inventoryWithRequirements(): ToolEvidenceInventory {
    return {
      experts: [],
      projects: [],
      requirements: [
        { code: "TR-01", title: "Team Leader CV", description: "Provide a CV for the proposed Team Leader, including ISO 9001 lead-auditor certification.", requirementType: "EXPERT", priority: "MANDATORY", requiredQuantity: 1, pageLimit: 3 },
        { code: "TR-02", title: "Hydraulic Engineer CV", description: "Provide CV for senior hydraulic engineer with EPANET experience.", requirementType: "EXPERT", priority: "SCORED", requiredQuantity: 1, pageLimit: 3 },
        { code: "EXP-01", title: "Three comparable projects", description: "Bidder must demonstrate three comparable water-supply projects within the last 5 years.", requirementType: "PROJECT_EXPERIENCE", priority: "MANDATORY", requiredQuantity: 3 },
        { code: null, title: "Audited financial statements", description: "Submit audited financial statements for the last 3 years.", requirementType: "FINANCIAL", priority: "MANDATORY" },
      ],
    };
  }

  it("matches by requirement code", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "TR-01" }, inventoryWithRequirements()) as { matchCount: number; requirements: Array<{ code: string | null; title: string }> };
    assert.equal(result.matchCount, 1);
    assert.equal(result.requirements[0].code, "TR-01");
    assert.equal(result.requirements[0].title, "Team Leader CV");
  });

  it("matches by title substring (case-insensitive)", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "audited financial" }, inventoryWithRequirements()) as { matchCount: number; requirements: Array<{ title: string }> };
    assert.equal(result.matchCount, 1);
    assert.match(result.requirements[0].title, /Audited financial/i);
  });

  it("matches against the description text", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "EPANET" }, inventoryWithRequirements()) as { matchCount: number; requirements: Array<{ code: string | null }> };
    assert.equal(result.matchCount, 1);
    assert.equal(result.requirements[0].code, "TR-02");
  });

  it("applies the priorityFilter when supplied", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "CV", priorityFilter: "MANDATORY" }, inventoryWithRequirements()) as { matchCount: number; requirements: Array<{ priority: string }> };
    // Both TR-01 and TR-02 match "CV" — but only TR-01 is MANDATORY.
    assert.equal(result.matchCount, 1);
    assert.equal(result.requirements[0].priority, "MANDATORY");
  });

  it("returns matchCount=0 with a helpful note when nothing matches", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "nonexistent" }, inventoryWithRequirements()) as { matchCount: number; note: string };
    assert.equal(result.matchCount, 0);
    assert.match(result.note, /Try a broader query/);
  });

  it("returns available=false when no requirements were supplied to the inventory", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "TR-01" }, { experts: [], projects: [] }) as { available: boolean; note: string };
    assert.equal(result.available, false);
    assert.match(result.note, /No tender requirements/);
  });

  it("returns an error when the query is empty", () => {
    const result = executeProposalTool("inspect_tender_requirement", { query: "" }, inventoryWithRequirements()) as { error: string };
    assert.match(result.error, /query is required/);
  });
});

describe("executeProposalTool — inspect_company_profile", () => {
  it("returns the company profile when supplied in the inventory", () => {
    const inv: ToolEvidenceInventory = {
      experts: [],
      projects: [],
      company: {
        name: "ABC Engineering",
        legalName: "ABC Engineering Consultants Ltd",
        country: "Ethiopia",
        foundingYear: 2008,
        headcount: 42,
        licenseGrade: "I",
        registrationNumber: "12345",
        tin: "0001234567",
        vat: "0009876543",
        gmName: "Dr. Hope Mekonnen",
        gmTitle: "Managing Director",
        gmLicense: "PE-001",
        serviceLines: ["water", "WASH"],
        sectors: ["water", "urban"],
        profileSummary: "Specialist water consultancy founded in 2008.",
      },
    };
    const result = executeProposalTool("inspect_company_profile", {}, inv) as { available: boolean; company: { name: string; foundingYear: number; tin: string } };
    assert.equal(result.available, true);
    assert.equal(result.company.name, "ABC Engineering");
    assert.equal(result.company.foundingYear, 2008);
    assert.equal(result.company.tin, "0001234567");
  });

  it("returns available=false with a bid-team note when no company profile is supplied", () => {
    const inv: ToolEvidenceInventory = { experts: [], projects: [] };
    const result = executeProposalTool("inspect_company_profile", {}, inv) as { available: boolean; note: string };
    assert.equal(result.available, false);
    assert.match(result.note, /Bid-Team Action/);
  });
});

describe("executeProposalTool — lookup_legal_record", () => {
  function inventoryWithRecords(): ToolEvidenceInventory {
    return {
      experts: [],
      projects: [],
      legalRecords: [
        { recordType: "LICENSE", title: "Engineering Consultancy License Grade I", authority: "MoCT", referenceNumber: "ECL-1234", issueDate: "2020-01-15", expiryDate: "2027-12-31", status: "ACTIVE" },
        { recordType: "ISO_9001", title: "ISO 9001:2015 Quality Management", authority: "BSI", referenceNumber: "ISO-99887", issueDate: "2021-03-10", expiryDate: "2024-03-09", status: "EXPIRED" },
        { recordType: "TAX_CLEARANCE", title: "Tax clearance certificate", authority: "ERCA", referenceNumber: "TC-2024-9912", issueDate: "2024-06-01", expiryDate: "2025-06-01", status: "ACTIVE" },
      ],
    };
  }

  it("returns all records when no recordType filter is supplied", () => {
    const result = executeProposalTool("lookup_legal_record", {}, inventoryWithRecords()) as { available: boolean; matchCount: number; records: Array<{ recordType: string }> };
    assert.equal(result.available, true);
    assert.equal(result.matchCount, 3);
  });

  it("filters by recordType substring (case-insensitive)", () => {
    const result = executeProposalTool("lookup_legal_record", { recordType: "iso" }, inventoryWithRecords()) as { matchCount: number; records: Array<{ recordType: string }> };
    assert.equal(result.matchCount, 1);
    assert.equal(result.records[0].recordType, "ISO_9001");
  });

  it("includes a computed `valid` field based on the expiry date", () => {
    const result = executeProposalTool("lookup_legal_record", {}, inventoryWithRecords()) as { records: Array<{ recordType: string; valid: boolean | null }> };
    const license = result.records.find((r) => r.recordType === "LICENSE");
    const iso = result.records.find((r) => r.recordType === "ISO_9001");
    // License expires 2027-12-31 — valid (vs current date)
    assert.equal(license?.valid, true);
    // ISO expired 2024-03-09 — invalid (vs current date)
    assert.equal(iso?.valid, false);
  });

  it("returns available=false with a bid-team note when no legal records exist", () => {
    const result = executeProposalTool("lookup_legal_record", {}, { experts: [], projects: [] }) as { available: boolean; note: string };
    assert.equal(result.available, false);
    assert.match(result.note, /Bid-Team Action/);
  });

  it("returns matchCount=0 with available record types when filter matches nothing", () => {
    const result = executeProposalTool("lookup_legal_record", { recordType: "INSURANCE" }, inventoryWithRecords()) as { matchCount: number; note: string };
    assert.equal(result.matchCount, 0);
    assert.match(result.note, /LICENSE|ISO_9001|TAX_CLEARANCE/);
  });
});

describe("executeProposalTool — search_company_knowledge", () => {
  it("returns matching experts when query targets a discipline", () => {
    const result = executeProposalTool("search_company_knowledge", { query: "EPANET hydraulic", type: "expert" }, inventory()) as { experts: Array<{ name: string; matchScore: number }> };
    assert.ok(result.experts);
    assert.ok(result.experts.length >= 1);
    assert.equal(result.experts[0].name, "Dr. Alemu Tadesse");
    assert.ok(result.experts[0].matchScore >= 2, "expected multi-token match for 'EPANET hydraulic'");
  });

  it("returns matching projects when query targets a sector", () => {
    const result = executeProposalTool("search_company_knowledge", { query: "WASH water supply", type: "project" }, inventory()) as { projects: Array<{ name: string }> };
    assert.ok(result.projects);
    assert.ok(result.projects.some((p) => p.name === "Sebeta WASH Feasibility and Detailed Design"));
  });

  it("returns both experts and projects when type=both (default)", () => {
    const result = executeProposalTool("search_company_knowledge", { query: "water supply Ethiopia" }, inventory()) as {
      experts: unknown[];
      projects: unknown[];
    };
    assert.ok(Array.isArray(result.experts));
    assert.ok(Array.isArray(result.projects));
  });

  it("returns an error when query is empty", () => {
    const result = executeProposalTool("search_company_knowledge", { query: "" }, inventory()) as { error?: string };
    assert.ok(result.error);
    assert.match(result.error!, /query is required/i);
  });

  it("respects max_results", () => {
    const result = executeProposalTool("search_company_knowledge", { query: "water", max_results: 1 }, inventory()) as {
      experts: unknown[];
      projects: unknown[];
    };
    assert.ok(result.experts.length <= 1);
    assert.ok(result.projects.length <= 1);
  });
});

describe("executeProposalTool — inspect_expert", () => {
  it("returns the full expert profile by partial name", () => {
    const result = executeProposalTool("inspect_expert", { name: "Alemu" }, inventory()) as { matchCount: number; experts: Array<{ name: string; profile: string | null }> };
    assert.equal(result.matchCount, 1);
    assert.equal(result.experts[0].name, "Dr. Alemu Tadesse");
    assert.ok(result.experts[0].profile && result.experts[0].profile.includes("EPANET"));
  });

  it("reports no match for an unknown name", () => {
    const result = executeProposalTool("inspect_expert", { name: "Smith" }, inventory()) as { matchCount: number; note?: string };
    assert.equal(result.matchCount, 0);
    assert.ok(result.note);
    assert.match(result.note!, /does not include/);
  });

  it("errors when name is missing", () => {
    const result = executeProposalTool("inspect_expert", {}, inventory()) as { error?: string };
    assert.ok(result.error);
  });
});

describe("executeProposalTool — inspect_project", () => {
  it("returns the full project profile by partial name", () => {
    const result = executeProposalTool("inspect_project", { name: "Sebeta" }, inventory()) as { matchCount: number; projects: Array<{ name: string; clientName: string }> };
    assert.equal(result.matchCount, 1);
    assert.match(result.projects[0].name, /Sebeta WASH/);
    assert.equal(result.projects[0].clientName, "Ethiopian Ministry of Water");
  });

  it("reports no match for an unknown project", () => {
    const result = executeProposalTool("inspect_project", { name: "Mars Colony Phase 1" }, inventory()) as { matchCount: number };
    assert.equal(result.matchCount, 0);
  });
});

describe("executeProposalTool — unknown tool", () => {
  it("returns an error listing available tools", () => {
    const result = executeProposalTool("delete_database", { query: "x" }, inventory()) as { error: string };
    assert.match(result.error, /Unknown tool/);
    assert.match(result.error, /search_company_knowledge/);
  });
});

describe("searchCompanyKnowledge convenience helper", () => {
  it("delegates to the executor with proper defaults", () => {
    const result = searchCompanyKnowledge("hydraulic", inventory()) as { experts: unknown[]; projects: unknown[] };
    assert.ok(Array.isArray(result.experts));
    assert.ok(Array.isArray(result.projects));
  });

  it("respects type and maxResults overrides", () => {
    const result = searchCompanyKnowledge("water", inventory(), { type: "expert", maxResults: 1 }) as { experts: unknown[]; projects?: unknown[] };
    assert.ok(result.experts.length <= 1);
    assert.equal(result.projects, undefined);
  });
});
