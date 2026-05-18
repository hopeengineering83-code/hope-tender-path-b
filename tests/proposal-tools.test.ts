// Unit tests for proposal-tools (gap #10 — tool-use during generation).
// Pure-function coverage of the tool executor + tool definitions.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  executeProposalTool,
  searchCompanyKnowledge,
  PROPOSAL_TOOL_DEFS,
  type ToolEvidenceInventory,
} from "../lib/engine/proposal-tools";

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
  it("declares three tools with required schemas", () => {
    assert.equal(PROPOSAL_TOOL_DEFS.length, 3);
    const names = PROPOSAL_TOOL_DEFS.map((t) => t.name).sort();
    assert.deepEqual(names, ["inspect_expert", "inspect_project", "search_company_knowledge"]);
    for (const def of PROPOSAL_TOOL_DEFS) {
      assert.ok(def.description.length > 30);
      assert.equal(def.input_schema.type, "object");
      assert.ok(def.input_schema.required && def.input_schema.required.length > 0);
    }
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
