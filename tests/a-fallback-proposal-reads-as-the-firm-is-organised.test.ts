// The deterministic proposal presents the team, the firm and its references
// the way an evaluator reads them, from the records alone.
//
// Run 36074770709 opened its team table, bios and Executive Summary with the
// first-ranked expert (a Senior Electrical Engineer) while the firm's General
// Manager and its Project Manager sat further down; A.1 described the firm by
// the tender's sector; each portfolio card's relevance row repeated the
// sector; and the work plan committed the firm to a fourteen-week programme on
// a tender that states no duration. The fixtures below are a school and a
// clinic, not the tender that exposed the gaps.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { orderTeamForPresentation } from "../lib/engine/team-order";
import { corporateFactsFromProfile } from "../lib/engine/company-profile-facts";
import { scopeItemsAnsweredByProject, scopeRelevanceSentence } from "../lib/engine/project-scope-relevance";
import { composeExecutiveSummary } from "../lib/engine/executive-summary-composer";
import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import { extractScopeItems, scopePlan } from "../lib/engine/scope-delivery-plan";
import type { ExpertRecord, ProjectRecord } from "../lib/engine/benchmark-tables";

const TENDER = [
  "[Page 3] SCOPE OF SERVICES",
  "1. Site Assessment",
  "The consultant shall assess the existing school buildings for structural adequacy.",
  "2. Architectural Design",
  "The consultant shall prepare concept and detailed architectural design for six classrooms.",
  "3. Regulatory Approvals",
  "The consultant shall obtain building permits and applicable approvals.",
  "4. Construction Supervision",
  "The consultant shall supervise the construction works for compliance with the approved design.",
  "[Page 4] EVALUATION CRITERIA",
].join("\n");

const TEAM = [
  { fullName: "E. Wire", title: "Senior Electrical Engineer", yearsExperience: 11 },
  { fullName: "A. Design", title: "Senior Architect", yearsExperience: 9, certifications: JSON.stringify(["Registered Architect (RA/101)"]) },
  { fullName: "P. Manager", title: "Project Manager / Senior Civil Engineer", yearsExperience: 15 },
  { fullName: "G. Principal", title: "General Manager & Structural Engineer", yearsExperience: 20 },
] as ExpertRecord[];

describe("the team is presented as it is organised", () => {
  it("puts the executive first, then the project manager, then scope leads in the tender's order", () => {
    const ordered = orderTeamForPresentation(TEAM, TENDER).map((e) => e.fullName);
    assert.equal(ordered[0], "G. Principal");
    assert.equal(ordered[1], "P. Manager");
    assert.ok(ordered.indexOf("A. Design") < ordered.indexOf("E. Wire"), ordered.join(", "));
    assert.equal(ordered.length, TEAM.length, "nobody is added or removed");
  });
});

describe("A.1 prints the firm's own corporate facts", () => {
  it("reads the first document's Label | Value rows and skips notes about the document", () => {
    const facts = corporateFactsFromProfile([
      "Company Profile",
      "Legal name | Example Consulting PLC",
      "Head office | Kigali, Rwanda",
      "Note | This summary was prepared for AI tools",
      "Company Profile",
      "Legal name | A later digest restating it",
    ].join("\n"));
    assert.deepEqual(facts, [
      { label: "Legal name", value: "Example Consulting PLC" },
      { label: "Head office", value: "Kigali, Rwanda" },
    ]);
  });
});

describe("a reference's relevance is the scope it answers, not the sector", () => {
  const items = extractScopeItems(TENDER);

  it("matches recorded services to scope items by the kind of work", () => {
    const matches = scopeItemsAnsweredByProject(JSON.stringify(["Structural assessment", "Architectural design", "Laboratory testing"]), items);
    assert.deepEqual(matches.map((m) => m.title), ["Site Assessment", "Architectural Design"]);
  });

  it("says nothing when the project records no services", () => {
    assert.equal(scopeRelevanceSentence("[]", items), "");
  });
});

describe("the Executive Summary is composed from the records", () => {
  it("names the need, the references' matching services and the team, and invents nothing", () => {
    const experts = orderTeamForPresentation(TEAM, TENDER);
    const plan = scopePlan({ tenderText: TENDER, experts });
    const projects = [
      { name: "District Clinic", country: "Rwanda", summary: "A 1,200 m² clinic.", serviceAreas: JSON.stringify(["Structural assessment", "Architectural design"]) },
    ] as ProjectRecord[];
    const summary = composeExecutiveSummary({
      companyName: "Example Consulting",
      clientName: "Ministry of Education",
      tenderTitle: "Design of Six Classrooms",
      primarySector: "Education",
      scopePlan: plan,
      projects,
      experts,
      evaluationCriteriaCount: 0,
    });
    assert.match(summary, /Ministry of Education has invited proposals for Design of Six Classrooms/);
    assert.match(summary, /runs through 4 items, from site assessment to construction supervision/);
    assert.match(summary, /On District Clinic \(Rwanda, 1,200 m²\), the firm's recorded services included structural assessment and architectural design/);
    assert.match(summary, /led by G\. Principal/);
    assert.match(summary, /P\. Manager, Project Manager \/ Senior Civil Engineer is proposed as Project Manager/);
    assert.doesNotMatch(summary, /Section F sets/, "no evaluation criteria, no sentence about them");
  });
});

describe("a work plan without a stated duration commits to a sequence, not to weeks", () => {
  it("places each phase by what starts it", () => {
    const phases = canonicalWorkPlan({ sector: "Education" });
    assert.equal(phases[0].durationLabel, "From the start of the assignment");
    assert.ok(phases.slice(1).every((p) => /^(?:After client sign-off of Phase \d+|Throughout the works|On completion of the works)$/.test(p.durationLabel)), phases.map((p) => p.durationLabel).join(" | "));
    assert.ok(phases.every((p) => !/\bweeks?\b/i.test(p.durationLabel)));
  });

  it("still speaks the tender's own days when it states a total", () => {
    const phases = canonicalWorkPlan({ sector: "Education", totalDays: 60 });
    assert.ok(phases.some((p) => /\bDays?\b/.test(p.durationLabel)), phases.map((p) => p.durationLabel).join(" | "));
  });
});

describe("a name's possessive", () => {
  it("takes the apostrophe alone after a final s", async () => {
    const { possessive } = await import("../lib/engine/possessive");
    assert.equal(possessive("Pharo Ventures"), "Pharo Ventures'");
    assert.equal(possessive("Ministry of Health"), "Ministry of Health's");
  });
});
