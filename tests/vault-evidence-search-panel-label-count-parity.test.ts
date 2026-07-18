// Regression test for a real, screenshot-verified contradiction: the "Show
// all reviewed experts (N)" / "Show all reviewed projects (N)" disclosures
// labeled their count using `reviewedExperts.length` / `reviewedProjects.length`
// (ALL reviewed records) but rendered `unselectedExperts` / `unselectedProjects`
// (reviewed records NOT already selected for this tender) inside. When every
// reviewed expert/project was already selected, the label read "Show all
// reviewed experts (1)" while expanding it showed "No reviewed experts in
// this group." — reproduced directly against a real tender with 1 reviewed,
// 1 selected expert.
//
// Fixed by using the same set (unselectedExperts/unselectedProjects) for both
// the label's count and the rendered list, renamed to "Show other reviewed
// experts/projects" to describe what it actually shows, and hiding the whole
// disclosure when there is nothing left to show (count === 0) instead of
// presenting an always-empty expandable section.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("components/vault-evidence-search-panel.tsx", "utf8");

describe("Vault Evidence Search Panel — disclosure label count matches the list it renders", () => {
  it("the 'other reviewed experts' disclosure labels and renders the same set (unselectedExperts)", () => {
    const block = src.slice(src.indexOf("unselectedExperts.length > 0"), src.indexOf("unselectedExperts.length > 0") + 800);
    assert.match(block, /Show other reviewed experts \(\{unselectedExperts\.length\}\)/);
    assert.match(block, /<ExpertList experts=\{unselectedExperts\}/);
  });

  it("the 'other reviewed projects' disclosure labels and renders the same set (unselectedProjects)", () => {
    const block = src.slice(src.indexOf("unselectedProjects.length > 0"), src.indexOf("unselectedProjects.length > 0") + 800);
    assert.match(block, /Show other reviewed projects \(\{unselectedProjects\.length\}\)/);
    assert.match(block, /<ProjectList projects=\{unselectedProjects\}/);
  });

  it("neither disclosure is labeled with the full reviewed count while rendering only the unselected subset", () => {
    assert.doesNotMatch(src, /Show all reviewed experts \(\{reviewedExperts\.length\}\)/);
    assert.doesNotMatch(src, /Show all reviewed projects \(\{reviewedProjects\.length\}\)/);
  });

  it("both disclosures are conditionally rendered so an empty unselected set doesn't show a dead-end expandable section", () => {
    assert.match(src, /\{unselectedExperts\.length > 0 && \(/);
    assert.match(src, /\{unselectedProjects\.length > 0 && \(/);
  });
});
