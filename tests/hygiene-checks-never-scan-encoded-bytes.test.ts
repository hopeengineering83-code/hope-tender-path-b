// A clean document must not be rejected because its BYTES happened to spell
// something.
//
// tests/owner-workflow-complete-postgres.test.ts failed in CI roughly one run
// in fifteen with:
//
//   readiness gate: 1 auto-finalized PDF(s) failed canonical validation
//
// The document was Technical-Proposal.pdf and the reason was "Placeholder or
// unresolved drafting instruction is present". Nothing was wrong with it. Its
// fileContent is base64, base64 is 100% printable ASCII and almost all
// letters, so looksLikePlainText accepted it and the hygiene patterns were run
// over the encoded bytes. The bytes contained
//
//     ...aXNnX/tBd/SsHxR2aG...
//
// where `/` is a word boundary on both sides, so /\b(TODO|TBD|FIXME)\b/i
// matched "tBd" and the export gate refused a valid PDF at random. "prompt",
// "claude", "gemini" and "todo" can fire the same way from the AI-trace
// pattern.
//
// These tests pin the fix: hygiene runs on text people wrote, never on encoded
// bytes — and it still catches every real defect in real text.

import { test } from "node:test";
import assert from "node:assert/strict";

import { documentHygieneIssues } from "../lib/engine/export-readiness";

const PDF_DOC = { name: "Technical Proposal", exactFileName: "Technical-Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF" };

test("the exact CI byte sequence no longer rejects a clean PDF", () => {
  // The real base64 run captured from the failing run.
  const bytes = "52ryscuKPyUHRAj8tSkLaf13WwfX++1JVsb4N1cSeenQODA0APhv6qEr2UBBkkMLYxzi/zoSRlygatnIpDNTwPJRhm0kr5ZBhSVACQ2vqUrioECK08wyqTM8I3HRtU27aYjV09bCqe6wXPaPnpcAYTJq0aXNnSX/tBd/SsHxR2aGOOD1btjGBHqk9LY+nmMUqQ9VDAaBZ9QAdTh6aJMUsvId6tjjvKHFc7HAfrzQPMydZReUJOatR6OoJFaoSHkjRZs0JrnkOewhiQkeyAlS2fyaOp1TNHDI2wlDaKLOZLeBpYpEZ9jM+0hDMBJ2fldh";
  assert.deepEqual(documentHygieneIssues(bytes, PDF_DOC), []);
});

test("no base64 payload can trip any hygiene pattern", () => {
  // Every word the three patterns look for, embedded in base64 exactly as the
  // encoder would leave it — surrounded by the alphabet's own separators.
  for (const word of ["tBd", "TODO", "fixme", "placeholder", "prompt", "claude", "gemini", "chatgpt"]) {
    const payload = `JVBERi0xLjQKJcfsj6IKNSAwIG9iago8PC9MZW5ndGgg${word}/QW5vdGhlckxvbmdSdW5PZkVuY29kZWRCeXRlc0hlcmVGb3JMZW5ndGg+PgpzdHJlYW0K${word}+VGhpc0lzU3RpbGxCYXNlNjRBbmROb3RQcm9zZQ==`;
    assert.deepEqual(documentHygieneIssues(payload, PDF_DOC), [], word);
  }
});

test("real prose containing a real placeholder is still rejected", () => {
  const text = "1. Introduction\nOur firm has delivered water supply schemes since 1998.\nProject manager: [insert name here].\nWe confirm compliance with all mandatory requirements.";
  assert.deepEqual(
    documentHygieneIssues(text, PDF_DOC),
    ["Placeholder or unresolved drafting instruction is present"],
  );
});

test("real prose containing a bare TBD is still rejected", () => {
  const text = "Section 3. Work Plan\nMobilisation begins in week one and the inception report follows in week three.\nSite supervisor: TBD.\nQuality assurance is led by the project director.";
  assert.deepEqual(
    documentHygieneIssues(text, PDF_DOC),
    ["Placeholder or unresolved drafting instruction is present"],
  );
});

test("real prose containing an AI trace is still rejected", () => {
  const text = "Executive Summary\nAs an AI language model I have prepared the following methodology for your consideration.\nOur approach addresses each mandatory requirement in turn.";
  assert.ok(documentHygieneIssues(text, PDF_DOC).includes("AI/meta-preparation trace text is present"));
});

test("a short base64-alphabet string is still treated as text", () => {
  // Not every letters-and-digits string is encoded bytes. The exclusion needs
  // real length before it applies, or a terse line of prose would escape.
  const short = "TBD";
  assert.deepEqual(documentHygieneIssues(short, PDF_DOC), []);
  // ...but a sentence of that length with a placeholder still fails.
  const sentence = "The nominated deputy team leader for this assignment is TBD and will be confirmed on award of contract.";
  assert.deepEqual(
    documentHygieneIssues(sentence, PDF_DOC),
    ["Placeholder or unresolved drafting instruction is present"],
  );
});

test("prose with punctuation is never mistaken for encoded bytes, however long", () => {
  const longProse = Array.from({ length: 40 }, (_, index) =>
    `Paragraph ${index + 1}. The contractor shall provide qualified personnel, materials and equipment for the works described herein.`,
  ).join("\n") + "\nSignature: [signature here]";
  assert.deepEqual(
    documentHygieneIssues(longProse, PDF_DOC),
    ["Placeholder or unresolved drafting instruction is present"],
  );
});

// ── One predicate, three consumers ─────────────────────────────────────────
//
// The same question — "is this encoded bytes or something a person wrote?" —
// was needed in three places. document-quality-validator had a correct answer;
// the two hygiene paths in export-readiness had none at all and relied on
// looksLikePlainText, which accepts base64. That is the same "one rule, two
// disagreeing copies" defect this engine keeps producing, and here the
// disagreement randomly refused a valid export.

import { readFileSync } from "node:fs";
import { looksLikeEncodedBytes } from "../lib/engine/encoded-content";

test("the encoded-bytes predicate is exact at its boundaries", () => {
  assert.equal(looksLikeEncodedBytes(null), false);
  assert.equal(looksLikeEncodedBytes(""), false);
  // Below the length floor a base64-alphabet string is still treated as text.
  assert.equal(looksLikeEncodedBytes("QUJDREVGRw=="), false);
  // A long unbroken base64 run is encoded bytes.
  assert.equal(looksLikeEncodedBytes("JVBERi0xLjQKJcfsj6IKNSAwIG9iago8PC9MZW5ndGgg".repeat(4)), true);
  // Long prose is never encoded bytes: it has punctuation and spaces.
  assert.equal(
    looksLikeEncodedBytes("The contractor shall provide qualified personnel and equipment for the works described in this section of the technical proposal."),
    false,
  );
  // A base64 payload wrapped at 76 columns (MIME style) is still bytes: the
  // newlines are well under the whitespace ceiling.
  const wrapped = Array.from({ length: 8 }, () => "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM=").join("\n");
  assert.equal(looksLikeEncodedBytes(wrapped), true);
});

test("every consumer reads the one predicate rather than its own copy", () => {
  for (const path of ["lib/engine/export-readiness.ts", "lib/engine/document-quality-validator.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /looksLikeEncodedBytes/, `${path} must use the shared predicate`);
    assert.doesNotMatch(
      source,
      /\/\^\[A-Za-z0-9\+\/\]\{40,\}/,
      `${path} must not keep a private base64 test`,
    );
  }
});

// ── The blocker names the document, and never crashes doing it ─────────────
//
// "1 auto-finalized PDF(s) failed canonical validation" identifies neither the
// file nor the defect, which is why this survived so long unnamed. The
// convergence summary now carries the rejected documents — but it is a
// summariser, and a caller building a partial result is entitled to omit them,
// so it must degrade to the bare count rather than throw. Reading
// `.rejected.length` directly did throw, on every existing fixture.

import { evaluateAutoFinalizeConvergence } from "../lib/ai-jobs/auto-finalize-continuation-service";

const CONVERGED = {
  sourceRepair: { checked: 3, repaired: 3, remaining: 0 },
  exportRepair: { repaired: 0, skipped: 0, manualRequired: 0 },
  validation: { validated: 2, failed: 0, pending: 0, rejected: [] },
  pdfFinalization: { finalized: 1, skipped: 0, failed: 0 },
  pdfValidation: { validated: 1, failed: 0, pending: 0, rejected: [] },
  packageReconciliation: { requiredTotal: 2, missing: 0 },
  missingFileGeneration: { generated: 0, planned: 0, skipped: 0, blocked: null },
  formReuse: { reused: 0, stillMissing: 0 },
  warning: null,
};

test("a rejected document is named in the blocker, with the validator's reason", () => {
  const blockers = evaluateAutoFinalizeConvergence({
    ...CONVERGED,
    pdfValidation: {
      validated: 0,
      failed: 1,
      pending: 0,
      rejected: [{
        documentId: "doc-1",
        fileName: "Technical-Proposal.pdf",
        reasons: ["Placeholder or unresolved drafting instruction is present"],
      }],
    },
  } as never);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0]!, /Technical-Proposal\.pdf/);
  assert.match(blockers[0]!, /Placeholder or unresolved drafting instruction is present/);
  // The "readiness gate" prefix must survive: stage-retry-policy matches on it
  // to classify the failure NON_RETRYABLE.
  assert.match(blockers[0]!, /^readiness gate: /);
});

test("an outcome with no rejected list degrades to the count instead of throwing", () => {
  const blockers = evaluateAutoFinalizeConvergence({
    ...CONVERGED,
    pdfValidation: { validated: 0, failed: 2, pending: 0 },
  } as never);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0]!, /2 auto-finalized PDF\(s\) failed canonical validation$/);
});

test("the first validation pass names its rejections too", () => {
  const blockers = evaluateAutoFinalizeConvergence({
    ...CONVERGED,
    validation: {
      validated: 0,
      failed: 1,
      pending: 0,
      rejected: [{ documentId: "d", fileName: "Methodology.docx", reasons: ["fileContent is missing"] }],
    },
  } as never);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0]!, /Methodology\.docx \(fileContent is missing\)/);
});
