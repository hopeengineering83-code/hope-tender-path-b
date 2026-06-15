// Regression tests for quality gap fixes from phase 4.
//
// Phase 4 addresses:
//   1. Submission Control Sheet added to proposal quality scorer's REQUIRED_SECTIONS
//   2. AI output section presence logging in generate-elite.ts
//   3. Submission Control Sheet added to structureCompleteness refinement directive

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── 1. proposal-quality-scorer.ts — Submission Control Sheet required ────────

describe("proposal-quality-scorer — Submission Control Sheet in REQUIRED_SECTIONS", () => {
  it("REQUIRED_SECTIONS includes submission control sheet pattern", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/proposal-quality-scorer.ts"), "utf8");
    assert.ok(
      src.includes("submission control sheet"),
      "REQUIRED_SECTIONS must include a /submission control sheet/i regex",
    );
  });

  it("quality scorer penalises proposals missing the Submission Control Sheet", () => {
    // Import and run the scorer with a proposal that lacks the section.
    // We test by importing the scorer directly (pure function, no DB).
    const { scoreProposalQuality } = require("../lib/engine/quality/proposal-quality-scorer");
    const markdownWithoutSheet = `
# Cover Letter
Dear Evaluation Committee, we are pleased to submit our proposal.
Our firm has delivered comparable projects since 2010, including Hospital X (ETB 120M, 2019).

# Executive Summary
We have already delivered this type of assignment. Hospital X (ETB 120M, 2019) demonstrates full capacity.
Our team lead Dr. Almaz Tadesse holds EIASC Grade A licence IPSTE/6884.

# Section A: Company Profile
Company background. Founded in 2005. 12 years experience.
Projects: Hospital X ETB 120M 2019, School Y ETB 45M 2021.

# Section B: Relevant Experience
Hospital X ETB 120M 2019 — full design supervision.

# Section C: Technical Approach
Methodology for all seven clinical zones.

# Section D: Additional Information
In-house MEP capability.

# Declaration of Eligibility
We confirm eligibility.
    `.trim();

    const score = scoreProposalQuality({
      markdown: markdownWithoutSheet,
      primarySector: "healthcare",
      topProjects: [],
    });
    // structureCompleteness should be lower because Submission Control Sheet is missing
    assert.ok(
      score.axes.structureCompleteness < 10,
      `structureCompleteness should be penalised when Submission Control Sheet is absent, got ${score.axes.structureCompleteness}`,
    );
  });

  it("quality scorer does not penalise structureCompleteness when Submission Control Sheet is present", () => {
    const { scoreProposalQuality } = require("../lib/engine/quality/proposal-quality-scorer");
    const markdownWithSheet = `
# Cover Letter
Dear Evaluation Committee, we are pleased to submit our proposal.
Our firm has delivered comparable projects since 2010, including Hospital X (ETB 120M, 2019).

# Executive Summary
We have already delivered this type of assignment. Hospital X (ETB 120M, 2019) demonstrates full capacity.
Our team lead Dr. Almaz Tadesse holds EIASC Grade A licence IPSTE/6884.

# Section A: Company Profile
Company background. Founded in 2005. 12 years experience.
Projects: Hospital X ETB 120M 2019, School Y ETB 45M 2021.

# Section B: Relevant Experience
Hospital X ETB 120M 2019 — full design supervision.

# Section C: Technical Approach
Methodology for all seven clinical zones plus MEP integration and phased delivery.

# Section D: Additional Information
In-house MEP capability and ISO 9001 certification.

# Declaration of Eligibility
We confirm eligibility under all stated criteria.

# Submission Control Sheet
Pre-submission checklist for the bid team.

## Submission Recipients
- **tenders@example.org**

## Submission Rules
- Deadline: 30 June 2026, 17:00 EAT
- Submit as PDF

## Document Format Requirements
- All documents in PDF format

## Pre-Submission Checklist
- [ ] Cover Letter signed
- [ ] CVs attached
    `.trim();

    const score = scoreProposalQuality({
      markdown: markdownWithSheet,
      primarySector: "healthcare",
      topProjects: [],
    });
    // structureCompleteness should be higher when the sheet is present
    assert.ok(
      score.axes.structureCompleteness >= 5,
      `structureCompleteness should improve when Submission Control Sheet is present, got ${score.axes.structureCompleteness}`,
    );
  });
});

// ─── 2. generate-elite.ts — mandatory section presence logging ────────────────

describe("generate-elite.ts — mandatory section presence check wired", () => {
  it("generate-elite.ts logs when AI output is missing mandatory sections", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    assert.ok(
      src.includes("AI output missing mandatory sections"),
      "generate-elite.ts must warn when AI output is missing mandatory sections",
    );
  });

  it("presence check covers all five expected sections", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    const idx = src.indexOf("AI output missing mandatory sections");
    assert.ok(idx !== -1, "presence check comment must be present");
    const region = src.slice(Math.max(0, idx - 600), idx + 200);
    assert.ok(region.includes("Compliance Matrix"), "check must cover Section E");
    assert.ok(region.includes("Evaluator Mirror") || region.includes("evaluation criteria response mirror"), "check must cover Section F");
    assert.ok(region.includes("Win Themes"), "check must cover Section G");
    assert.ok(region.includes("Self-Score") || region.includes("self.score"), "check must cover Section H");
    assert.ok(region.includes("Submission Control Sheet"), "check must cover Submission Control Sheet");
  });
});

// ─── 3. ai.ts — structureCompleteness refinement mentions Submission Control Sheet

describe("ai.ts — refinement directive includes Submission Control Sheet", () => {
  it("structureCompleteness directive mentions Submission Control Sheet", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/ai.ts"), "utf8");
    const idx = src.indexOf("structureCompleteness:");
    assert.ok(idx !== -1, "structureCompleteness directive must exist");
    const directive = src.slice(idx, idx + 500);
    assert.ok(
      directive.includes("Submission Control Sheet"),
      "structureCompleteness refinement directive must mention Submission Control Sheet so refinement fills it when missing",
    );
  });
});
