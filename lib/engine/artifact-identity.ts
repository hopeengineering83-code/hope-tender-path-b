// Artifact identity — one authority for "is this file what it claims to be?"
//
// PROVEN LIVE DEFECT
// ──────────────────
// Document cd1dacc5-d415-47c3-acda-27bc55442574 was named
// "Technical Proposal.pdf", declared format DOCX, contained DOCX (PK zip)
// bytes, and was VALIDATED. Reproduced on this head before the fix:
//
//   inspectActualFileBytes(...)      → MISMATCH / FILE_SIGNATURE_MISMATCH
//   checkFullExportReadiness(...)    → only "validationStatus is PENDING",
//                                      "reviewStatus is PENDING"
//   deriveDocumentOutputState(...)   → READY_FOR_EXPORT
//   isFinalExportCandidateDocument() → true
//
// The primitive knew. Nothing on the release path asked it.
//
// THREE LINKED GAPS
// ─────────────────
// 1. checkFullExportReadiness ran the byte/signature check only when the
//    caller passed requireFileContent: true. auto-finalize's
//    runCanonicalValidation SELECTS fileContent but passes false, so the one
//    pass that decides VALIDATED never looked at the bytes. The flag conflates
//    "must bytes be present" with "were bytes loaded".
// 2. Nothing compared the DECLARED format column against the filename
//    extension or the detected bytes, so "named .pdf, declared DOCX" was
//    invisible to every check.
// 3. deriveDocumentOutputState ignored integrity entirely, so a mismatched row
//    reached READY_FOR_EXPORT the moment its statuses were set.
//
// FOUR LABELS, ONE TRUTH
// ──────────────────────
// A generated artifact carries four independent claims about what it is:
//
//   filename extension   "Technical Proposal.pdf"     → PDF
//   declared format      GeneratedDocument.format     → DOCX
//   claimed MIME         GeneratedDocument.contentMimeType
//   the bytes themselves %PDF- / PK.. magic
//
// plus the persisted integrity metadata that is supposed to record their
// agreement. They must all say the same thing. Any disagreement means the file
// is not what it claims, and a submission built from it would be rejected by
// the procuring entity — a .pdf that will not open is a failed bid.
//
// This module is the single place that decides. It adds no new magic-byte
// table: detection comes from persisted-byte-integrity's
// inspectActualFileBytes, and extension mapping from export-format-policy's
// formatFromExtension. Generation, validation, auto-finalize, readiness,
// download, manifest and ZIP all read this one verdict.

import { inspectActualFileBytes } from "./persisted-byte-integrity";
import { formatFromExtension } from "./export-format-policy";

export type ArtifactIdentityCode =
  | "FILE_SIGNATURE_MISMATCH"
  | "DECLARED_FORMAT_MISMATCH"
  | "PERSISTED_FORMAT_MISMATCH"
  | "INTEGRITY_NOT_VERIFIED"
  | "UNSUPPORTED_EXTENSION"
  | "EMPTY_FILE_BYTES";

export type ArtifactIdentityVerdict = {
  /** True only when every label present agrees. */
  agrees: boolean;
  code: ArtifactIdentityCode | null;
  /** Owner-readable sentence naming the disagreement. Null when it agrees. */
  reason: string | null;
  extensionFormat: string | null;
  declaredFormat: string | null;
  detectedFormat: string | null;
  /** True when the verdict was reached by reading real bytes. */
  inspectedBytes: boolean;
};

export type ArtifactIdentityInput = {
  fileName?: string | null;
  name?: string | null;
  /** GeneratedDocument.format — the DECLARED format. */
  format?: string | null;
  contentMimeType?: string | null;
  /** Persisted detection from a previous inspection, when bytes are absent. */
  detectedFormat?: string | null;
  integrityStatus?: string | null;
  /** Real bytes, when the caller has them. Decisive when present. */
  bytes?: Buffer | Uint8Array | null;
};

const AGREES: ArtifactIdentityVerdict = {
  agrees: true, code: null, reason: null,
  extensionFormat: null, declaredFormat: null, detectedFormat: null, inspectedBytes: false,
};

/** Normalise a format label from any of the four sources to one vocabulary. */
export function normaliseFormatLabel(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  // "OTHER"/"UNKNOWN" assert nothing about the bytes, so they are not a claim
  // that can disagree with one. Treating them as a concrete label made every
  // legitimately-unclassified entry look mismatched.
  if (raw === "OTHER" || raw === "UNKNOWN" || raw === "NONE") return null;
  if (raw === "DOC") return "DOCX";
  if (raw === "XLS") return "XLSX";
  if (raw === "TXT") return "TEXT";
  if (raw === "MD") return "MARKDOWN";
  return raw;
}

function extensionLabel(fileName: string | null | undefined): string | null {
  const mapped = formatFromExtension(String(fileName ?? ""));
  return mapped ? normaliseFormatLabel(mapped) : null;
}

/**
 * A DOCX is a PK zip, so byte detection reports ZIP when it cannot tell which
 * OOXML flavour it holds. That is agreement with a DOCX/XLSX label, not
 * disagreement — the disagreement that matters is ZIP bytes under a .pdf name.
 */
function detectedMatches(detected: string | null, expected: string | null): boolean {
  if (!detected || !expected) return true;
  if (detected === expected) return true;
  if (detected === "ZIP" && (expected === "DOCX" || expected === "XLSX")) return true;
  return false;
}

/**
 * Decide whether every label this artifact carries agrees.
 *
 * Bytes are decisive when supplied. Without bytes the persisted detection and
 * integrity status are used, so metadata-only surfaces still refuse a row that
 * a previous inspection already found mismatched.
 */
export function resolveArtifactIdentity(input: ArtifactIdentityInput): ArtifactIdentityVerdict {
  const fileName = String(input.fileName ?? input.name ?? "").trim();
  const extensionFormat = extensionLabel(fileName);
  const declaredFormat = normaliseFormatLabel(input.format);
  const bytes = input.bytes ? Buffer.from(input.bytes) : null;

  // ── Label-vs-label: cheap, needs no bytes, and catches the live defect's
  // "named .pdf, declared DOCX" on its own.
  if (extensionFormat && declaredFormat && extensionFormat !== declaredFormat) {
    return {
      agrees: false,
      code: "DECLARED_FORMAT_MISMATCH",
      reason: `"${fileName}" has a .${extensionFormat.toLowerCase()} extension but the document declares format ${declaredFormat}. The file name and the declared format must agree.`,
      extensionFormat, declaredFormat, detectedFormat: null, inspectedBytes: false,
    };
  }

  if (bytes) {
    if (bytes.length === 0) {
      return {
        agrees: false, code: "EMPTY_FILE_BYTES",
        reason: `"${fileName}" has no bytes.`,
        extensionFormat, declaredFormat, detectedFormat: null, inspectedBytes: true,
      };
    }
    const inspected = inspectActualFileBytes({
      bytes,
      filename: fileName,
      claimedMimeType: input.contentMimeType ?? null,
    });
    const detectedFormat = normaliseFormatLabel(inspected.detectedFormat);
    if (inspected.integrityStatus === "MISMATCH") {
      return {
        agrees: false,
        code: "FILE_SIGNATURE_MISMATCH",
        reason: `"${fileName}" does not contain ${extensionFormat ?? declaredFormat ?? "the declared"} content — its bytes are ${detectedFormat ?? "unrecognised"} (${inspected.integrityFailureCode}). A file that will not open is a failed submission.`,
        extensionFormat, declaredFormat, detectedFormat, inspectedBytes: true,
      };
    }
    if (inspected.integrityStatus === "UNSUPPORTED") {
      return {
        agrees: false,
        code: "UNSUPPORTED_EXTENSION",
        reason: `"${fileName}" carries a label its bytes cannot be checked against (${inspected.integrityFailureCode}).`,
        extensionFormat, declaredFormat, detectedFormat, inspectedBytes: true,
      };
    }
    if (!detectedMatches(detectedFormat, declaredFormat)) {
      return {
        agrees: false,
        code: "DECLARED_FORMAT_MISMATCH",
        reason: `"${fileName}" declares format ${declaredFormat} but its bytes are ${detectedFormat}.`,
        extensionFormat, declaredFormat, detectedFormat, inspectedBytes: true,
      };
    }
    return { ...AGREES, extensionFormat, declaredFormat, detectedFormat, inspectedBytes: true };
  }

  // ── No bytes: fall back to what a previous inspection persisted. This is how
  // metadata-only surfaces (dashboards, output-state derivation) stay honest.
  const persistedDetected = normaliseFormatLabel(input.detectedFormat);
  const integrityStatus = String(input.integrityStatus ?? "").trim().toUpperCase();
  if (integrityStatus === "MISMATCH") {
    return {
      agrees: false,
      code: "INTEGRITY_NOT_VERIFIED",
      reason: `"${fileName}" was recorded as failing byte-integrity verification (${integrityStatus}).`,
      extensionFormat, declaredFormat, detectedFormat: persistedDetected, inspectedBytes: false,
    };
  }
  if (persistedDetected && !detectedMatches(persistedDetected, extensionFormat ?? declaredFormat)) {
    return {
      agrees: false,
      code: "PERSISTED_FORMAT_MISMATCH",
      reason: `"${fileName}" is labelled ${extensionFormat ?? declaredFormat} but its recorded byte format is ${persistedDetected}.`,
      extensionFormat, declaredFormat, detectedFormat: persistedDetected, inspectedBytes: false,
    };
  }
  return { ...AGREES, extensionFormat, declaredFormat, detectedFormat: persistedDetected, inspectedBytes: false };
}

/** Convenience for the many call sites that only need the blocking reason. */
export function artifactIdentityBlocker(input: ArtifactIdentityInput): string | null {
  const verdict = resolveArtifactIdentity(input);
  return verdict.agrees ? null : `${verdict.code}: ${verdict.reason}`;
}
