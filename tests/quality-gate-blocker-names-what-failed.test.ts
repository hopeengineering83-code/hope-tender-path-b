/**
 * A blocker that names only a count is not an evidence trail.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real owner run stopped at:
 *
 *   AUTO_FINALIZE_NOT_CONVERGED — the export readiness check refuses this
 *   package — 0 document blocker(s) and 1 tender-level blocker(s) remain:
 *   GENERATED_DOCUMENT_QUALITY_FAILED
 *
 * That sentence was the whole trail. Not which document, not its score, not
 * what was wrong with it. The cause turned out to be environmental — the PDF
 * workers were missing from the serverless bundle, so a required PDF's text
 * could not be extracted and it scored 10/100 for having read nothing — and
 * from the blocker text alone that is indistinguishable from a genuinely bad
 * document. Establishing which it was took reading the stored bytes by hand.
 *
 * The gate itself is correct and is NOT weakened here: a document whose
 * content cannot be read must still fail closed. What changes is that the
 * failure now says what failed and why.
 *
 * The second test is the one that matters for safety: these records travel
 * into logs, so they must carry metadata and never document content.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

const SRC = readFileSync(path.join(process.cwd(), "lib/engine/final-submission-readiness.ts"), "utf8");

/** The diagnostic block added beside the GENERATED_DOCUMENT_QUALITY_FAILED blocker. */
function diagnosticBlock(): string {
  const start = SRC.indexOf('logger.warn("[final-readiness] documents failed the quality gate"');
  assert.ok(start > 0, "the quality-gate diagnostic must exist");
  return SRC.slice(start, start + 1600);
}

describe("the quality-gate blocker records what failed", () => {
  it("logs the fields needed to diagnose a failure without re-reading the database", () => {
    const block = diagnosticBlock();
    for (const field of ["documentId", "fileName", "score", "recommendedStatus", "issueCodes"]) {
      assert.ok(block.includes(field), `the diagnostic must record ${field}`);
    }
  });

  it("records whether any visible text was recovered — the tell for an extraction failure", () => {
    // A document with bytes but no recoverable text is an environment
    // problem, not a writing problem. Without this field the two look
    // identical in the logs, which is precisely what cost the investigation.
    assert.ok(diagnosticBlock().includes("visibleTextRecovered"));
  });

  it("carries no document content, source text or credentials into the logs", () => {
    const block = diagnosticBlock();
    // Match content-CARRYING expressions, not bare substrings: the safe
    // boolean `visibleTextRecovered` legitimately contains "visibleText", and
    // an over-broad check here would fail on its own safe field — which it
    // did on first run.
    const contentAccessors = [
      /\bvisibleText\s*[:,)]/,
      /\.\s*visibleText\b/,
      /\bfileContent\b/,
      /\bcontentSummary\b/,
      /\brawText\b/,
      /\bextractedText\b/,
      /\breviewNotes\b/,
      /\bsourceExactQuote\b/,
    ];
    for (const accessor of contentAccessors) {
      assert.ok(!accessor.test(block), `the diagnostic must not log ${accessor}`);
    }
  });

  it("logs only primitives, so no record object can carry content by accident", () => {
    // Spreading a document (`...doc`) would quietly ship whatever fields the
    // projection happens to hold, content included.
    const block = diagnosticBlock();
    assert.ok(!/\.\.\.\s*doc\b/.test(block), "must not spread the document into the log record");
    assert.ok(!/\.\.\.\s*report\b/.test(block), "must not spread the quality report into the log record");
  });

  it("only fires when something actually failed", () => {
    // A gate that logs on every healthy run trains people to ignore it.
    const start = SRC.indexOf('logger.warn("[final-readiness] documents failed the quality gate"');
    const preceding = SRC.slice(Math.max(0, start - 1400), start);
    assert.ok(preceding.includes("if (qualityFailed > 0)"), "diagnostic must be guarded by qualityFailed > 0");
  });
});

describe("the gate still fails closed on a document it could not read", () => {
  it("scores an unreadable PDF as QUALITY_FAILED rather than passing it", () => {
    // This is the behaviour the packaging fix restores extraction FOR — it
    // must not be softened. Bytes present, text unreadable, still refused.
    const report = assessGeneratedDocumentQuality({
      doc: { id: "d1", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF" },
      visibleText: null,
      rawFileContent: "JVBERi0xLjcKcHJlc2VudC1idXQtdW5yZWFkYWJsZQ==",
      hasStoragePath: false,
      requirements: [],
    });
    assert.equal(report.recommendedStatus, "QUALITY_FAILED");
    assert.ok(report.wordCount === 0, "an unreadable document must report zero words, which is the diagnostic tell");
  });
});
