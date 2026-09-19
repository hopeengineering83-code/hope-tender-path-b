import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  resolveReviewedSectionEvidence,
  sectionEvidenceBlocker,
} from "../lib/engine/regenerate-section-evidence";

const route = readFileSync("app/api/tenders/[id]/regenerate-section/route.ts", "utf8");
const evidenceSource = readFileSync("lib/engine/regenerate-section-evidence.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("authoritative section evidence resolver", () => {
  it("prefers authoritative selected evidence over Vault fallback", () => {
    const result = resolveReviewedSectionEvidence({
      selectedExperts: [
        { id: "draft-selected", trustLevel: "AI_DRAFT" },
        { id: "source-verified-selected", trustLevel: "SOURCE_VERIFIED" },
      ],
      selectedProjects: [{ id: "reviewed-project", trustLevel: "REVIEWED" }],
      vaultExperts: [{ id: "vault-expert", trustLevel: "REVIEWED" }],
      vaultProjects: [{ id: "vault-project", trustLevel: "SOURCE_VERIFIED" }],
    });

    assert.deepEqual(result.experts.map((item) => item.id), ["source-verified-selected"]);
    assert.deepEqual(result.projects.map((item) => item.id), ["reviewed-project"]);
    assert.equal(result.expertSource, "SELECTED_REVIEWED");
    assert.equal(result.projectSource, "SELECTED_REVIEWED");
  });

  it("uses SOURCE_VERIFIED Vault evidence without a human-review requirement", () => {
    const result = resolveReviewedSectionEvidence({
      selectedExperts: [{ id: "selected-expert", trustLevel: "AI_DRAFT" }],
      selectedProjects: [{ id: "selected-project", trustLevel: "REGEX_DRAFT" }],
      vaultExperts: [{ id: "vault-expert", trustLevel: "SOURCE_VERIFIED" }],
      vaultProjects: [{ id: "vault-project", trustLevel: "SOURCE_VERIFIED" }],
    });

    assert.deepEqual(result.experts.map((item) => item.id), ["vault-expert"]);
    assert.deepEqual(result.projects.map((item) => item.id), ["vault-project"]);
    assert.equal(result.expertSource, "VAULT_REVIEWED");
    assert.equal(result.projectSource, "VAULT_REVIEWED");
  });

  it("never returns draft/unverified selected or Vault records", () => {
    const result = resolveReviewedSectionEvidence({
      selectedExperts: [{ id: "selected-expert", trustLevel: "AI_DRAFT" }],
      selectedProjects: [{ id: "selected-project", trustLevel: null }],
      vaultExperts: [{ id: "vault-expert", trustLevel: "REGEX_DRAFT" }],
      vaultProjects: [{ id: "vault-project", trustLevel: "MANUAL_DRAFT" }],
    });

    assert.deepEqual(result.experts, []);
    assert.deepEqual(result.projects, []);
    assert.equal(result.expertSource, "NONE");
    assert.equal(result.projectSource, "NONE");
  });

  it("blocks evidence-dependent sections when authoritative proof is absent", () => {
    assert.deepEqual(sectionEvidenceBlocker({
      sectionId: "technical-approach",
      expertCount: 0,
      projectCount: 1,
    })?.code, "NO_REVIEWED_EXPERT_EVIDENCE");

    assert.deepEqual(sectionEvidenceBlocker({
      sectionId: "company-and-experience",
      expertCount: 1,
      projectCount: 0,
    })?.code, "NO_REVIEWED_PROJECT_EVIDENCE");

    assert.equal(sectionEvidenceBlocker({
      sectionId: "cover-and-summary",
      expertCount: 0,
      projectCount: 0,
    }), null);
  });
});

describe("section regeneration release authority", () => {
  it("passes the canonical gate before loading prompt evidence", () => {
    const gatePos = route.indexOf("assertTenderReadyForGenerationAndExport({");
    const queryPos = route.indexOf("const [tender, companyBase] = await Promise.all");
    const supportEvidencePos = route.indexOf("loadDurableCompanySupportRecords(");
    assert.ok(gatePos >= 0 && queryPos > gatePos);
    assert.ok(supportEvidencePos > queryPos);
    assert.match(route, /purpose: "regenerate-section"/);
    assert.match(route, /Resolve the canonical generation-readiness blocker/);
  });

  it("contains no draft-evidence fallback path", () => {
    assert.doesNotMatch(route, /using .*unreviewed selected/i);
    assert.doesNotMatch(route, /experts\s*=\s*tender\.expertMatches\.map/);
    assert.doesNotMatch(route, /projects\s*=\s*tender\.projectMatches\.map/);
    assert.match(route, /resolveReviewedSectionEvidence/);
    assert.match(evidenceSource, /SOURCE_VERIFIED/);
    assert.match(evidenceSource, /NO_REVIEWED_EXPERT_EVIDENCE/);
    assert.match(evidenceSource, /NO_REVIEWED_PROJECT_EVIDENCE/);
  });

  it("never returns deterministic fallback markdown as successful generation", () => {
    assert.doesNotMatch(route, /buildSectionFallback/);
    assert.doesNotMatch(route, /AI unavailable — returned deterministic section/);
    assert.match(route, /AI_SECTION_REGENERATION_UNAVAILABLE/);
    assert.match(route, /success: false/);
    assert.match(route, /fallbackApplied: false/);
    assert.match(route, /No deterministic fallback was applied/);
  });

  it("returns markdown only from a successful provider-chain result", () => {
    const successRegion = route.slice(route.indexOf("return NextResponse.json({\n      success: true"));
    assert.match(successRegion, /markdown: sectionMarkdown/);
    assert.match(successRegion, /fallback: false/);
    assert.match(successRegion, /aiGenerated: true/);
    assert.doesNotMatch(successRegion, /deterministic/);
  });

  it("keeps provider-chain usage and usage tracking intact", () => {
    assert.match(route, /generateWithFallback/);
    assert.match(route, /recordAiUsage/);
    assert.match(route, /useCase: "proposal"/);
  });

  it("keeps Git-triggered Vercel deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});