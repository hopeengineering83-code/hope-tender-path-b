import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every surface that counts "the current documents" must derive that set from
// ONE selection. Superseded, replaced, outside-plan and stale rows stay in the
// database for audit, but must never count as current outputs, create quality
// blockers, enter the ZIP, or reduce readiness.
//
// Four independent copies of the rule existed:
//   1. components/document-validator-panel.tsx  (fixed: selectCurrentDocuments)
//   2. lib/engine/final-submission-readiness.ts (already canonical)
//   3. lib/canonical-tender-readiness.ts        — narrowed for `missing` only,
//      leaving NO_ACTIVE_GENERATED_DOCUMENTS, hasDocuments and
//      readyForFinalExport counting the raw query result
//   4. lib/tender-readiness-state.ts            — a private regex testing
//      generationStatus for SUPERSEDED|PLANNED only

import { computeTenderReadinessState } from "../lib/tender-readiness-state";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Rows that are NOT current outputs, one per exclusion the canonical rule makes. */
const HISTORICAL_ROWS = [
  { label: "superseded generation", generationStatus: "SUPERSEDED" },
  { label: "superseded validation", generationStatus: "GENERATED", validationStatus: "SUPERSEDED" },
  { label: "planned", generationStatus: "PLANNED" },
  { label: "queued", generationStatus: "QUEUED" },
  { label: "stale", generationStatus: "STALE" },
  { label: "generating", generationStatus: "GENERATING" },
  { label: "failed", generationStatus: "FAILED" },
  { label: "not exportable", generationStatus: "GENERATED", reviewStatus: "NOT_EXPORTABLE" },
  { label: "replace with original", generationStatus: "GENERATED", reviewStatus: "REPLACE_WITH_ORIGINAL" },
  { label: "control format", generationStatus: "GENERATED", format: "CONTROL" },
  { label: "submission control", generationStatus: "GENERATED", documentType: "SUBMISSION_CONTROL" },
];

describe("The canonical selection is the only rule", () => {
  for (const row of HISTORICAL_ROWS) {
    it(`excludes a ${row.label} row`, () => {
      assert.equal(isFinalExportCandidateDocument(row as never), false);
    });
  }

  it("includes a genuinely current row", () => {
    assert.equal(isFinalExportCandidateDocument({
      name: "Technical Proposal.docx",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "PENDING",
    } as never), true);
  });
});

describe("Readiness state counts only current documents", () => {
  it("does not treat a historical row as an active document", () => {
    // Every row here is historical. The old private regex matched only
    // SUPERSEDED|PLANNED, so a QUEUED / STALE / NOT_EXPORTABLE / CONTROL row
    // counted as active and could make documentsCurrent true.
    const state = computeTenderReadinessState({
      generatedDocuments: HISTORICAL_ROWS.map((r) => ({ ...r, contentSummary: null })),
    } as never);
    assert.equal(state.documentsCurrent, false,
      "no historical row may make the document set look current");
  });

  it("uses the canonical predicate rather than a private regex", () => {
    const src = read("lib/tender-readiness-state.ts");
    assert.ok(src.includes("isFinalExportCandidateDocument"),
      "readiness state must use the canonical selection");
    // Match the regex LITERAL, not the phrase — the replacement's comment
    // legitimately names the old pattern to explain what was wrong with it.
    assert.ok(!/\/SUPERSEDED\|PLANNED\/i/.test(src),
      "the private generationStatus regex must be gone");
  });
});

describe("Canonical readiness counters all read the same set", () => {
  const src = read("lib/canonical-tender-readiness.ts");

  it("selects the current documents once", () => {
    assert.match(src, /const currentDocuments = filterFinalExportCandidateDocuments\(/);
  });

  for (const [label, pattern] of [
    ["NO_ACTIVE_GENERATED_DOCUMENTS", /currentDocuments\.length === 0 \? \["NO_ACTIVE_GENERATED_DOCUMENTS"\]/],
    ["hasDocuments", /hasDocuments: currentDocuments\.length > 0/],
    ["readyForFinalExport", /readyForFinalExport: currentDocuments\.length > 0/],
    ["missing planned files", /findMissingGeneratedDocuments\(plan, currentDocuments/],
    ["readiness state input", /generatedDocuments: currentDocuments,/],
  ] as Array<[string, RegExp]>) {
    it(`${label} counts the current set`, () => {
      assert.match(src, pattern);
    });
  }

  it("keeps the ONE deliberate broad read, and says why", () => {
    // A reused tender-issued form sits at REPLACE_WITH_ORIGINAL, which the
    // canonical selection excludes — and that is exactly the state this blocker
    // reports. It must stay on the broad list.
    const broad = src.match(/const tenderFormsAwaitingCompletion = tender\.generatedDocuments/);
    assert.ok(broad, "the tender-form blocker must read the broad list");
    const preamble = src.slice(Math.max(0, src.indexOf("const tenderFormsAwaitingCompletion") - 500),
      src.indexOf("const tenderFormsAwaitingCompletion"));
    assert.match(preamble, /REPLACE_WITH_ORIGINAL/,
      "the deliberate exception must explain itself so it is not 'fixed' later");
  });

  it("has no other raw generatedDocuments count", () => {
    const rawCounts = src.match(/tender\.generatedDocuments\.length/g) ?? [];
    assert.deepEqual(rawCounts, [],
      "every count must go through currentDocuments");
  });
});

describe("The validator panel and the manifest share the selection", () => {
  it("the Document Validator selects current documents canonically", () => {
    assert.ok(read("components/document-validator-panel.tsx").includes("selectCurrentDocuments"));
  });

  it("the Final Package Manifest selects current documents canonically", () => {
    assert.ok(read("components/final-package-manifest-panel.tsx").includes("isFinalExportCandidateDocument"));
  });

  it("the submission plan completeness loader selects current documents canonically", () => {
    assert.ok(read("lib/engine/submission-plan-completeness.ts").includes("isFinalExportCandidateDocument"));
  });
});
