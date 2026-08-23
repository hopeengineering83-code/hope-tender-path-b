// A file must be what it claims to be — decided in ONE place.
//
// PROVEN LIVE DEFECT, reproduced on this head before the fix:
// document cd1dacc5-d415-47c3-acda-27bc55442574 was named
// "Technical Proposal.pdf", declared format DOCX, held DOCX (PK zip) bytes,
// and was VALIDATED. The probe showed:
//
//   inspectActualFileBytes      → MISMATCH / FILE_SIGNATURE_MISMATCH
//   checkFullExportReadiness    → only "validationStatus is PENDING",
//                                 "reviewStatus is PENDING"
//   deriveDocumentOutputState   → READY_FOR_EXPORT
//   isFinalExportCandidateDoc   → true
//
// The primitive knew. Nothing on the release path asked it. Worse, because the
// only readiness failures were workflow reasons, auto-finalize's
// runCanonicalValidation — which filters those out and marks everything else
// VALIDATED — actively set validationStatus VALIDATED on it.
//
// Four labels, one truth: filename extension, declared format column, claimed
// MIME, and the bytes themselves must agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

import { resolveArtifactIdentity, artifactIdentityBlocker } from "../lib/engine/artifact-identity";
import {
  deriveDocumentOutputState,
  isFinalExportCandidateDocument,
  hasConsistentArtifactIdentity,
  exportBlockReason,
  EXPORT_BLOCKING_STATES,
} from "../lib/engine/document-output-state";

async function docxBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", "<?xml version=\"1.0\"?><w:document xmlns:w=\"x\"><w:body/></w:document>");
  return zip.generateAsync({ type: "nodebuffer" });
}
const pdfBytes = () => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(400, 0x20), Buffer.from("\n%%EOF\n")]);

test("the exact live defect: .pdf name, DOCX declared, DOCX bytes", async () => {
  const verdict = resolveArtifactIdentity({
    fileName: "Technical Proposal.pdf",
    format: "DOCX",
    bytes: await docxBytes(),
  });
  assert.equal(verdict.agrees, false);
  // The label contradiction is caught before the bytes are even read.
  assert.equal(verdict.code, "DECLARED_FORMAT_MISMATCH");
  assert.match(verdict.reason!, /\.pdf extension but the document declares format DOCX/);
});

test("a .pdf holding DOCX bytes fails even when the declared format also says PDF", async () => {
  const verdict = resolveArtifactIdentity({
    fileName: "Technical Proposal.pdf",
    format: "PDF",
    bytes: await docxBytes(),
  });
  assert.equal(verdict.agrees, false);
  assert.equal(verdict.code, "FILE_SIGNATURE_MISMATCH");
  assert.match(verdict.reason!, /will not open is a failed submission/);
});

test("a genuine PDF agrees on every label", () => {
  const verdict = resolveArtifactIdentity({
    fileName: "Technical Proposal.pdf",
    format: "PDF",
    contentMimeType: "application/pdf",
    bytes: pdfBytes(),
  });
  assert.equal(verdict.agrees, true);
  assert.equal(verdict.code, null);
  assert.equal(verdict.detectedFormat, "PDF");
  assert.equal(verdict.inspectedBytes, true);
});

test("a genuine DOCX agrees — ZIP detection is not a contradiction of DOCX", async () => {
  const verdict = resolveArtifactIdentity({
    fileName: "Technical Proposal.docx",
    format: "DOCX",
    bytes: await docxBytes(),
  });
  assert.equal(verdict.agrees, true, verdict.reason ?? "");
});

test("without bytes, a previously recorded mismatch still refuses the row", () => {
  assert.equal(
    resolveArtifactIdentity({
      fileName: "Technical Proposal.pdf", format: "PDF",
      detectedFormat: "ZIP", integrityStatus: "VERIFIED",
    }).code,
    "PERSISTED_FORMAT_MISMATCH",
  );
  assert.equal(
    resolveArtifactIdentity({
      fileName: "Technical Proposal.pdf", format: "PDF", integrityStatus: "MISMATCH",
    }).code,
    "INTEGRITY_NOT_VERIFIED",
  );
});

test("a mislabelled artifact can never be an export candidate or reach READY_FOR_EXPORT", () => {
  // Statuses are exactly what the live defect passed on, so set them all green.
  const mislabelled = {
    id: "d1", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf",
    documentType: "TECHNICAL_PROPOSAL", format: "DOCX",
    generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED",
    detectedFormat: "DOCX", integrityStatus: "VERIFIED",
  };
  assert.equal(hasConsistentArtifactIdentity(mislabelled), false);
  assert.equal(isFinalExportCandidateDocument(mislabelled), false);
  assert.equal(deriveDocumentOutputState(mislabelled), "ARTIFACT_IDENTITY_MISMATCH");
  assert.ok(EXPORT_BLOCKING_STATES.includes("ARTIFACT_IDENTITY_MISMATCH"));
  assert.match(exportBlockReason("ARTIFACT_IDENTITY_MISMATCH")!, /will not open for the evaluator/);
});

test("the correctly-labelled equivalents stay export-ready — the gate is not blunt", () => {
  for (const [fileName, format] of [
    ["Technical Proposal.pdf", "PDF"],
    ["Technical Proposal.docx", "DOCX"],
    ["Bill of Quantities.xlsx", "XLSX"],
  ] as const) {
    const doc = {
      id: "d", name: "Doc", exactFileName: fileName, documentType: "TECHNICAL_PROPOSAL",
      format, generationStatus: "GENERATED", validationStatus: "VALIDATED",
      reviewStatus: "APPROVED", detectedFormat: format, integrityStatus: "VERIFIED",
      // Bytes must exist for the row to be anything but a control record —
      // that check predates this work and is correct. storagePath stands in for
      // real bytes without inlining a blob per case.
      storagePath: `s3://bucket/${fileName}`,
    };
    assert.equal(isFinalExportCandidateDocument(doc), true, fileName);
    assert.equal(deriveDocumentOutputState(doc), "READY_FOR_EXPORT", fileName);
  }
});

test("a tender-required file with no extension is not punished for having none", () => {
  // Real tenders demand files named exactly, sometimes without an extension.
  // There is no label for the bytes to contradict, so this must not fail.
  const verdict = resolveArtifactIdentity({ fileName: "Annex C Declaration", format: "DOCX" });
  assert.equal(verdict.agrees, true, verdict.reason ?? "");
});

test("artifactIdentityBlocker returns a single actionable string or null", async () => {
  assert.equal(artifactIdentityBlocker({ fileName: "a.pdf", format: "PDF", bytes: pdfBytes() }), null);
  const blocker = artifactIdentityBlocker({ fileName: "a.pdf", format: "PDF", bytes: await docxBytes() });
  assert.match(blocker!, /^FILE_SIGNATURE_MISMATCH: /);
});

test("the extension→format mapping has one owner, not a fourth private copy", () => {
  const identity = readFileSync("lib/engine/artifact-identity.ts", "utf8");
  assert.match(identity, /import \{ formatFromExtension \} from "\.\/export-format-policy"/);
  assert.match(identity, /import \{ inspectActualFileBytes \} from "\.\/persisted-byte-integrity"/);
  // No new magic-byte table. Comment lines are stripped: the header quotes the
  // signatures while explaining the defect, and that is documentation, not a
  // second implementation.
  const code = identity.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.doesNotMatch(code, /0x50, 0x4b|%PDF-/);
});

test("the byte check runs whenever bytes exist, not only when the caller demanded them", () => {
  const readiness = readFileSync("lib/engine/export-readiness.ts", "utf8");
  // The old form skipped the whole check on requireFileContent:false — which is
  // exactly what auto-finalize passes while holding the bytes.
  assert.doesNotMatch(readiness, /opts\.requireFileContent\s*\n?\s*\?\s*await checkExportFileByteReadiness/);
  assert.match(readiness, /await checkExportFileByteReadiness\(\s*opts\.docs,\s*opts\.requireFileContent === true,\s*\)/);
});
