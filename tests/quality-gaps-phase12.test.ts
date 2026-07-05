// Regression tests for quality gap fixes from phase 12.
//
// Phase 12 addresses:
//   win-themes-builder.ts: buildWinThemesSection returned null when
//   differentiators was empty, even when requirements, projects, or experts
//   were present. Section G was silently absent on any tender where
//   proposal-intelligence did not extract structured firm differentiators,
//   scoring 0/10 on the winThemesPresence quality axis.
//   Fix: synthesise plausible differentiator claims from requirements,
//   projects, experts, and sector when differentiators is empty.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildWinThemesSection,
  hasWinThemesHeading,
} from "../lib/engine/win-themes-builder";

describe("buildWinThemesSection — synthesised differentiators from requirements", () => {
  it("returns non-null when differentiators is empty but requirements are present", () => {
    const result = buildWinThemesSection({
      differentiators: [],
      evaluationCriteria: [],
      topProjects: [],
      topExperts: [],
      companyName: "Acme Consulting",
      clientName: "Ministry of Water",
      primarySector: "Water",
      requirements: [
        { title: "Key Expert CVs", requirementType: "EXPERT" },
        { title: "Methodology and Work Plan", requirementType: "METHODOLOGY" },
      ],
    });
    assert.ok(result !== null, "should produce Section G when differentiators can be synthesised from requirements");
  });

  it("returns non-null when differentiators is empty but top projects are available", () => {
    const result = buildWinThemesSection({
      differentiators: [],
      evaluationCriteria: [],
      topProjects: [{ name: "Adama Water Supply Scheme", clientName: "MoWIE", contractValue: 5_000_000, currency: "ETB" }],
      topExperts: [],
      companyName: "Acme Consulting",
      clientName: "Ministry of Water",
      primarySector: "Water",
      requirements: [],
    });
    assert.ok(result !== null, "should produce Section G when a top project is available");
  });

  it("synthesised output contains a Section G heading", () => {
    const result = buildWinThemesSection({
      differentiators: [],
      evaluationCriteria: ["Track record of similar assignments"],
      topProjects: [],
      topExperts: [{ fullName: "Tigist Bekele", title: "Senior Water Engineer" }],
      companyName: "Acme Consulting",
      clientName: "City Administration",
      primarySector: "Infrastructure",
      requirements: [{ title: "Similar project experience", requirementType: "PROJECT_EXPERIENCE" }],
    });
    assert.ok(result !== null);
    assert.ok(hasWinThemesHeading(result!), "output must contain a Section G / Win Themes heading");
  });

  it("synthesised output contains a markdown table with at least one data row", () => {
    const result = buildWinThemesSection({
      differentiators: [],
      evaluationCriteria: [],
      topProjects: [],
      topExperts: [],
      companyName: "Acme Consulting",
      clientName: "Client",
      primarySector: "Health",
      requirements: [
        { title: "CVs of Proposed Experts", requirementType: "EXPERT" },
        { title: "Risk Management Plan", requirementType: "METHODOLOGY" },
      ],
    });
    assert.ok(result !== null);
    const rows = result!.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Win Theme") && !l.startsWith("|---"));
    assert.ok(rows.length >= 1, `expected at least one data row, got ${rows.length}`);
  });

  it("returns null when differentiators, requirements, projects, and experts are all empty", () => {
    const result = buildWinThemesSection({
      differentiators: [],
      evaluationCriteria: [],
      topProjects: [],
      topExperts: [],
      companyName: "Acme Consulting",
      clientName: "Client",
      primarySector: "General",
      requirements: [],
    });
    assert.strictEqual(result, null);
  });

  it("does not synthesise when differentiators are already populated", () => {
    const result = buildWinThemesSection({
      differentiators: ["In-house GIS laboratory with licensed ArcGIS Pro and QGIS — not subcontracted"],
      evaluationCriteria: [],
      topProjects: [],
      topExperts: [],
      companyName: "Acme Consulting",
      clientName: "Client",
      primarySector: "Geospatial",
      requirements: [{ title: "Key Expert CVs", requirementType: "EXPERT" }],
    });
    assert.ok(result !== null);
    assert.ok(result!.includes("GIS"), "explicit differentiator should appear in output");
  });

  it("synthesised output references the primary sector", () => {
    const result = buildWinThemesSection({
      differentiators: [],
      evaluationCriteria: [],
      topProjects: [],
      topExperts: [],
      companyName: "Acme Consulting",
      clientName: "Client",
      primarySector: "Education",
      requirements: [{ title: "Methodology", requirementType: "METHODOLOGY" }],
    });
    assert.ok(result !== null);
    assert.ok(result!.toLowerCase().includes("education"), "synthesised themes should reference the primary sector");
  });
});
