import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression pin for the live-tender contradiction:
//
//   Document Validator : "Technical Proposal.pdf — CLEAN, Warning 0, Blocked 0"
//   Export Readiness   : GENERATED_DOCUMENT_QUALITY_FAILED, validationStatus
//                        PENDING, reviewStatus PENDING, manifest not validated
//
// Two independent causes, both pinned here:
//   1. the two surfaces selected DIFFERENT document sets, so a stale /
//      superseded / replaced / outside-plan row counted for one and not the
//      other;
//   2. the two surfaces ran DIFFERENT quality assessors, so they could not
//      agree even on the same row.

import {
  selectCurrentDocuments,
  resolveCurrentDocumentVerdict,
  assessCurrentDocumentQualityBatch,
  countQualityFailed,
} from "../lib/engine/current-document-quality";
import { filterFinalExportCandidateDocuments } from "../lib/engine/document-output-state";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "d",
    name: "Technical Proposal.pdf",
    exactFileName: "Technical Proposal.pdf",
    documentType: "TECHNICAL",
    format: "PDF",
    fileContent: "Short body.",
    storagePath: null,
    generationStatus: "GENERATED",
    validationStatus: "PENDING",
    reviewStatus: "PENDING",
    ...overrides,
  };
}

describe("Document status truth — one canonical current-document selection", () => {
  it("the validator panel and the readiness gate use the same selection function", () => {
    const panel = read("components/document-validator-panel.tsx");
    const readiness = read("lib/engine/final-submission-readiness.ts");
    assert.ok(panel.includes("selectCurrentDocuments"), "panel must use the canonical selection");
    assert.ok(
      readiness.includes("filterFinalExportCandidateDocuments"),
      "readiness must use the canonical selection",
    );
    const shared = read("lib/engine/current-document-quality.ts");
    assert.ok(
      /export function selectCurrentDocuments[\s\S]{0,200}filterFinalExportCandidateDocuments/.test(shared),
      "selectCurrentDocuments must delegate to filterFinalExportCandidateDocuments — not re-derive the rule",
    );
  });

  it("the panel no longer filters on generationStatus != SUPERSEDED alone", () => {
    const panel = read("components/document-validator-panel.tsx");
    assert.ok(
      !/generationStatus:\s*\{\s*not:\s*"SUPERSEDED"\s*\}/.test(panel),
      "the panel's old query admitted QUEUED/STALE/PLANNED and validationStatus-SUPERSEDED rows",
    );
  });

  it("selectCurrentDocuments agrees with the export-candidate filter exactly", () => {
    const rows = [
      doc({ id: "current", generationStatus: "GENERATED" }),
      doc({ id: "superseded-generation", generationStatus: "SUPERSEDED" }),
      doc({ id: "superseded-validation", validationStatus: "SUPERSEDED" }),
      doc({ id: "not-exportable", reviewStatus: "NOT_EXPORTABLE" }),
      doc({ id: "replaced", reviewStatus: "REPLACE_WITH_ORIGINAL" }),
      doc({ id: "stale", generationStatus: "STALE" }),
      doc({ id: "queued", generationStatus: "QUEUED" }),
      doc({ id: "planned", generationStatus: "PLANNED" }),
      doc({ id: "control", format: "CONTROL" }),
      doc({ id: "submission-control", documentType: "SUBMISSION_CONTROL" }),
    ];
    const selected = selectCurrentDocuments(rows).map((d) => d.id);
    assert.deepEqual(selected, ["current"]);
    assert.deepEqual(selected, filterFinalExportCandidateDocuments(rows).map((d) => d.id));
  });

  it("historical, superseded, replaced and stale rows cannot produce a current QUALITY_FAILED", async () => {
    // Every non-current row here would be QUALITY_FAILED if it were assessed —
    // the content is a one-liner. None may reach the current count.
    const rows = [
      doc({ id: "superseded-generation", generationStatus: "SUPERSEDED" }),
      doc({ id: "superseded-validation", validationStatus: "SUPERSEDED" }),
      doc({ id: "not-exportable", reviewStatus: "NOT_EXPORTABLE" }),
      doc({ id: "replaced", reviewStatus: "REPLACE_WITH_ORIGINAL" }),
      doc({ id: "stale", generationStatus: "STALE" }),
    ];
    const current = selectCurrentDocuments(rows);
    assert.equal(current.length, 0, "no historical row may be treated as current");
    const reports = await assessCurrentDocumentQualityBatch(current);
    assert.equal(countQualityFailed(reports), 0, "historical rows must not raise a current quality failure");
  });
});

describe("Document status truth — one canonical machine assessment", () => {
  it("the readiness gate scores documents through the shared helper", () => {
    const readiness = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      readiness.includes("assessCurrentDocumentQualityBatch"),
      "readiness must score through lib/engine/current-document-quality.ts",
    );
    assert.ok(
      !/assessGeneratedDocumentQuality\(\{/.test(readiness),
      "readiness must not call the assessor directly — that is how the two assessors drifted",
    );
  });

  it("the panel carries no private placeholder/AI-trace/envelope regexes", () => {
    const panel = read("components/document-validator-panel.tsx");
    for (const banned of [
      "PLACEHOLDER_RE",
      "AI_TRACE_RE",
      "EMPTY_SECTION_RE",
      "FINANCIAL_IN_TECHNICAL_RE",
      "TECHNICAL_IN_FINANCIAL_RE",
      "function checkDocument",
    ]) {
      assert.ok(!panel.includes(banned), `panel must not re-declare ${banned}`);
    }
  });

  it("a document the readiness gate fails is never rendered Clean", async () => {
    const verdict = await resolveCurrentDocumentVerdict(doc());
    assert.equal(verdict.report.recommendedStatus, "QUALITY_FAILED");
    assert.equal(verdict.score, "BLOCKED");
    assert.ok(verdict.reasons.length > 0, "a blocked document must state why");
  });

  it("the combined verdict blocks on the strict validator too, not only the readiness gate", async () => {
    // The strict validator (download / PDF-finalise / auto-finalize path) and
    // the narrative readiness gate catch different defects. Neither is a
    // superset, so the rendered verdict must be the union.
    const body = "Contact: Bid-Team to confirm.\n" + "Genuine methodology content. ".repeat(400);
    const verdict = await resolveCurrentDocumentVerdict(
      doc({ name: "Technical Proposal.docx", exactFileName: "Technical Proposal.docx", format: "DOCX", fileContent: body }),
    );
    assert.equal(verdict.validation.status, "BLOCKED");
    assert.equal(verdict.score, "BLOCKED");
  });

  it("unifying the panel did not lose the detection its private patterns had", () => {
    // The panel's own list caught a bare "language model"; the canonical
    // AI_TRACE_PATTERNS only matched the prefixed forms. Adopting the canonical
    // list without this would have silently weakened the check.
    const patterns = read("lib/engine/detection-patterns.ts");
    assert.ok(/\/\\blanguage\\s\+model\\b\/i/.test(patterns),
      "canonical AI_TRACE_PATTERNS must match a bare 'language model'");
  });
});

describe("Document status truth — machine validation stays separate from human approval", () => {
  it("the panel never writes reviewStatus or approves a document", () => {
    const panel = read("components/document-validator-panel.tsx");
    assert.ok(!/prisma\.generatedDocument\.update/.test(panel), "the panel is read-only");
    assert.ok(!/reviewStatus:\s*"(APPROVED|READY_FOR_EXPORT)"/.test(panel), "the panel must not grant approval");
  });

  it("a clean machine verdict does not by itself imply owner approval", async () => {
    const clean = "## Methodology\n" + "Detailed engineering methodology for the water supply scheme. ".repeat(400);
    const verdict = await resolveCurrentDocumentVerdict(
      doc({ name: "Technical Proposal.docx", exactFileName: "Technical Proposal.docx", format: "DOCX", fileContent: clean }),
    );
    // Whatever the machine says, the stored human reviewStatus is untouched.
    assert.equal(verdict.doc.reviewStatus, "PENDING");
  });
});
