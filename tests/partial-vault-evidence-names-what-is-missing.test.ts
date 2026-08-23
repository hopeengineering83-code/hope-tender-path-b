// A Partial row must say WHAT is missing, not "strengthen the evidence".
//
// The live tender's panel read:
//
//   "Partial evidence exists for 2 requirement(s), but it is not
//    release-qualified. Strengthen it with eligible source-backed evidence;
//    release remains blocked."
//
// and each row read "Automatically linked. The Engine will strengthen this
// requirement when more specific eligible evidence or validated output bytes
// become available." Neither names the record or the shortfall, so the owner
// has a blocker and no next step.
//
// The engine already knows. MIN_AUTOMATIC_LINK_SCORE is 70, and a candidate
// with complete facets at 70+ is FULL — so a vault link at PARTIAL always
// means a structured constraint the tender states is genuinely absent from the
// record, and evaluateCandidateFacets returns exactly which one. It simply was
// not being carried through to the owner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateCandidateFacets,
  serializeAutomaticRequirementEvidence,
  parseAutomaticRequirementEvidence,
  type AutomaticEvidenceCandidate,
  type AutomaticRequirementEvidenceMetadata,
} from "../lib/engine/automatic-requirement-coverage";

const SHA = "a".repeat(64);

function expertCandidate(overrides: Partial<AutomaticEvidenceCandidate> = {}): AutomaticEvidenceCandidate {
  return {
    recordType: "EXPERT",
    recordId: "expert-1",
    label: "Hana Tesfaye",
    searchableText: "Hana Tesfaye Senior Water Engineer Water Engineering",
    evidenceKinds: ["EXPERT_CV"],
    evidenceKey: "EXPERT:expert-1",
    sourceDocumentId: "doc-1",
    sourceContentHash: SHA,
    sourceByteLength: 128,
    selected: true,
    generatedReady: false,
    exactFileName: null,
    facets: { yearsExperience: 8, disciplines: ["Water Engineering"] },
    ...overrides,
  };
}

const YEARS_REQUIREMENT = {
  id: "req-1",
  title: "Senior Water Engineer",
  description: "The Senior Water Engineer shall have a minimum 15 years experience and hold a valid professional registration.",
  requirementType: "EXPERT",
  priority: "MANDATORY",
};

test("the engine identifies exactly which tender constraint the record fails", () => {
  const facets = evaluateCandidateFacets(YEARS_REQUIREMENT, expertCandidate());
  assert.equal(facets.complete, false);
  assert.ok(facets.missing.includes("minimumExperience"), "8 years does not meet a stated minimum of 15");
  assert.ok(facets.matched.includes("discipline"), "the discipline it does carry is still credited");
});

test("a record that carries every stated constraint has nothing missing", () => {
  const facets = evaluateCandidateFacets(
    YEARS_REQUIREMENT,
    expertCandidate({
      facets: { yearsExperience: 16, disciplines: ["Water Engineering"] },
      searchableText: "Hana Tesfaye Senior Water Engineer Water Engineering professional registration certified",
    }),
  );
  assert.deepEqual(facets.missing, []);
  assert.equal(facets.complete, true);
});

test("the missing constraints survive the round trip through persisted metadata", () => {
  const metadata: AutomaticRequirementEvidenceMetadata = {
    version: 1,
    evidenceKey: "EXPERT:expert-1",
    recordType: "EXPERT",
    recordId: "expert-1",
    label: "Hana Tesfaye",
    requirementId: "req-1",
    requirementSourceFileId: "file-1",
    requirementSourceQuoteHash: SHA,
    sourceDocumentId: "doc-1",
    sourceContentHash: SHA,
    sourceByteLength: 128,
    sourceFileName: "cv.pdf",
    matchedFacets: ["discipline"],
    missingFacets: ["minimumExperience", "certification"],
    sourceRevision: SHA,
    evidenceRevision: SHA,
    linkageScore: 76,
    linkageReasons: ["direct evidence family: EXPERT_CV"],
    state: "ACTIVE",
  };
  const parsed = parseAutomaticRequirementEvidence(serializeAutomaticRequirementEvidence(metadata));
  assert.ok(parsed);
  assert.deepEqual(parsed!.missingFacets, ["minimumExperience", "certification"]);
});

test("older persisted rows without the field still parse", () => {
  // The field is additive: rows written before it existed must keep working
  // rather than being discarded as unparseable and re-created.
  const legacy = {
    version: 1, evidenceKey: "EXPERT:expert-1", recordType: "EXPERT", recordId: "expert-1",
    label: "Hana Tesfaye", requirementId: "req-1", requirementSourceFileId: "file-1",
    requirementSourceQuoteHash: SHA, sourceDocumentId: "doc-1", sourceContentHash: SHA,
    sourceByteLength: 128, sourceFileName: "cv.pdf", matchedFacets: ["discipline"],
    sourceRevision: SHA, evidenceRevision: SHA, linkageScore: 76, linkageReasons: [], state: "ACTIVE",
  };
  const parsed = parseAutomaticRequirementEvidence(
    serializeAutomaticRequirementEvidence(legacy as AutomaticRequirementEvidenceMetadata),
  );
  assert.ok(parsed, "a row written before missingFacets existed must still parse");
  assert.equal(parsed!.missingFacets, undefined);
});

test("the route names the missing constraint instead of asking for generic evidence", () => {
  const route = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");
  // The facet reaches the owner in plain words, attributed to the record.
  assert.match(route, /does not state \$\{missing\.map\(humanizeFacet\)/);
  assert.match(route, /minimumExperience: "the minimum years of experience"/);
  // ...and it says the fix is a vault edit, not a re-upload.
  assert.match(route, /nothing needs re-uploading/);
  // The generic sentence survives only as the fallback for a link with no
  // recorded facet shortfall, never as the only thing the owner is told.
  const generic = route.match(/The Engine will strengthen this requirement/g) ?? [];
  assert.equal(generic.length, 1);
});

test("the panel banner points at the rows rather than repeating an unactionable instruction", () => {
  const panel = readFileSync("components/requirement-coverage-panel.tsx", "utf8");
  // Comment lines are stripped: the old wording is deliberately quoted in a
  // comment that explains why it changed, and that must not fail this check.
  const rendered = panel.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.doesNotMatch(rendered, /Strengthen it with eligible source-backed evidence/);
  assert.match(panel, /Each row below names the missing detail/);
  assert.match(panel, /missingFacets: string\[\]/);
});
