import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateCandidateFacets,
  selectAutomaticEvidenceForRequirement,
  type AutomaticEvidenceCandidate,
} from "../lib/engine/automatic-requirement-coverage";
import { extractRequirementSources } from "../lib/engine/requirement-source-extractor";
import { canonicalRequirementIdentity, deduplicateRequirements } from "../lib/engine/stable-requirements";

const HASH = "a".repeat(64);
const requirement = (overrides: Record<string, unknown> = {}) => ({
  id: "req-expert",
  title: "Two civil engineering experts with at least 10 years experience",
  description: "Provide two qualified civil engineers with a degree and at least 10 years experience.",
  requirementType: "EXPERT",
  priority: "MANDATORY",
  restrictions: null,
  requiredQuantity: 2,
  exactFileName: null,
  sourceTenderFileId: "file-1",
  sourcePageNumber: 3,
  sourceExactQuote: "Two qualified civil engineers with at least 10 years experience are required.",
});

const expert = (id: string, years: number): AutomaticEvidenceCandidate => ({
  recordType: "EXPERT",
  recordId: id,
  label: `Civil Engineer ${id}`,
  searchableText: "qualified civil engineer bachelor degree 12 years experience infrastructure",
  evidenceKinds: ["EXPERT_CV"],
  evidenceKey: `EXPERT:${id}:${HASH}`,
  sourceDocumentId: `doc-${id}`,
  sourceContentHash: HASH,
  sourceByteLength: 2048,
  selected: false,
  generatedReady: false,
  exactFileName: null,
  sourceFileName: `${id}.pdf`,
  evidenceRevision: HASH,
  facets: { yearsExperience: years, disciplines: ["civil engineering"], qualification: "Bachelor degree" },
});

describe("canonical requirement-evidence resolver runtime fixture", () => {
  it("promotes complete source-verified experts to FULL and enforces complementary quantity", () => {
    const one = selectAutomaticEvidenceForRequirement(requirement(), [expert("one", 12)]);
    assert.equal(one.length, 1);
    assert.equal(one[0].supportLevel, "SUBSTANTIAL", "one expert cannot satisfy a quantity of two");

    const two = selectAutomaticEvidenceForRequirement(requirement(), [expert("one", 12), expert("two", 15)]);
    assert.equal(two.length, 2);
    assert.ok(two.every((row) => row.supportLevel === "FULL"));
    assert.equal(evaluateCandidateFacets(requirement(), two[0].candidate).complete, true);
  });

  it("keeps incomplete structured project evidence fail-closed", () => {
    const projectRequirement = requirement({
      id: "req-project",
      title: "Relevant completed project reference",
      description: "Provide a similar completed project with client, sector, scope, location and dates.",
      requirementType: "PROJECT_EXPERIENCE",
      requiredQuantity: 1,
    });
    const project: AutomaticEvidenceCandidate = {
      ...expert("project", 12),
      recordType: "PROJECT",
      label: "Water design assignment",
      searchableText: "similar water design project sector scope",
      evidenceKinds: ["PROJECT_REFERENCE"],
      evidenceKey: `PROJECT:project:${HASH}`,
      facets: { sector: "water", serviceAreas: ["design"], location: "Kenya" },
    };
    assert.equal(evaluateCandidateFacets(projectRequirement, project).complete, false);
    assert.notEqual(selectAutomaticEvidenceForRequirement(projectRequirement, [project])[0]?.supportLevel, "FULL");
  });

  it("rejects Evaluation Criteria boilerplate as a project-reference source quote", () => {
    const [result] = extractRequirementSources({
      tenderFileId: "file-1",
      tenderFileText: "[Page 5]\n\nEVALUATION CRITERIA\n\nThe tender provides evaluation criteria but does not provide percentage weights. Evaluation weights are not provided.",
      requirements: [{ id: "req-project", title: "Relevant feasibility design and supervision project references", description: "Submit similar completed project references." }],
    });
    assert.equal(result.sourceConfidence, 0);
    assert.equal(result.sourceExactQuote, undefined);
  });

  it("keeps semantic identities and deduplication stable across repeated runs", () => {
    const first = requirement({ title: "Project references for past performance", description: "Provide references." });
    const duplicate = requirement({ title: "Past-performance project reference", description: "Provide detailed client references." });
    assert.equal(canonicalRequirementIdentity(first), canonicalRequirementIdentity(duplicate));
    assert.equal(deduplicateRequirements([first, duplicate] as any).length, 1);
  });

  it("renders exact status truth and an unweighted primary percentage", () => {
    const panel = readFileSync("components/requirement-coverage-panel.tsx", "utf8");
    const route = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");
    // Renamed from "Genuine gaps / unresolved". The bucket holds both
    // TRUE_EVIDENCE_GAP and STALE_OR_INVALIDATED rows, so naming it after the
    // first left the stat tile ("Genuine gaps", 5) contradicting the chip
    // ("Genuine gaps / unresolved", 6) on the same screen. See
    // tests/requirement-coverage-counter-truth.test.ts.
    assert.match(panel, /Genuine gaps \/ stale/);
    assert.doesNotMatch(panel, /Automatic source grounding continues/);
    assert.doesNotMatch(panel, /automatic work/i);
    assert.match(panel, /No resolver job is queued or running/);
    assert.match(route, /fullyCovered \/ totalMandatory/);
    assert.match(route, /weightedProgressRatio/);
    assert.match(route, /jobType: "ENGINE_RUN"/);
    assert.match(route, /resolverRunning: Boolean\(activeResolverJob\)/);
  });
});
