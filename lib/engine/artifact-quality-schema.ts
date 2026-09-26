// One authority for "what quality schema does THIS artifact answer to?"
//
// THE DEFECT THIS REPLACES
// ------------------------
// The export-readiness quality gate chose a required-section list by
// `documentType`. But `documentType` describes the SUBMISSION the artifact
// belongs to, not what the artifact itself is. A complete Technical Proposal
// and a single methodology narrative are both persisted as
// `TECHNICAL_PROPOSAL`, so the gate demanded that a methodology document
// contain a Cover Letter, an Understanding of the Assignment, a Work Plan, a
// Team Composition, a Compliance Matrix and a Submission Checklist — that is,
// it required a section to contain its own siblings. Observed on
// 2026-09-20 (`/api/tenders/{id}/validate`, HTTP 422):
//
//   Technical Approach and Methodology  [QUALITY GATE score=28]
//   Missing required sections: Cover Letter, Understanding of the Assignment,
//   Work Plan, Team Composition, Compliance Matrix, Submission Checklist
//
// A one-off had already been patched into the gate for exactly this shape:
// cover letters were re-routed by name because "DEFAULT_REQUIRED_SECTIONS_BY_TYPE
// has no COVER_LETTER key of its own". That was the same bug, handled for one
// document kind. This module handles the general case.
//
// THE RULE
// --------
// An artifact whose own name IS one of the section titles its documentType
// declares is a COMPONENT of that document, not the document. The parent's
// section list is therefore the wrong schema for it, and applying it can only
// ever produce a guaranteed failure.
//
// The rule derives entirely from the existing section table, so it needs no
// per-tender, per-sector or per-filename knowledge: whatever sections a
// document type declares, artifacts named after those sections are its
// components. Adding a document type or renaming a section keeps working
// without touching this file.
//
// WHAT A COMPONENT IS VALIDATED AGAINST
// -------------------------------------
// Its own content rules, which already exist in
// `lib/engine/document-quality-gate.ts` — that module matches on the artifact's
// own label and enforces, for a methodology/work-plan/approach document,
// `phases, tasks, deliverables, schedule, qa, risk` and an 800-word floor.
// Returning no parent sections here therefore REMOVES a wrong requirement
// without removing a real one, and deliberately avoids creating a third
// competing quality authority in a codebase that has already been bitten by
// having two.
//
// Cover letters keep the letter-shaped check the gate already applied to them,
// so that behaviour is preserved rather than re-derived.

export type ArtifactRole = "COMPLETE_DOCUMENT" | "COMPONENT";

export type ArtifactQualitySchema = {
  role: ArtifactRole;
  /** The key the content validator should treat this artifact as. */
  schemaKey: string;
  /** Section titles this artifact must contain. Empty means "no parent-level requirement". */
  requiredSections: string[];
  /** Why this schema was chosen — surfaced in diagnostics, never guessed at by a reader. */
  rationale: string;
  /** The parent section title matched, when this is a component. */
  matchedSectionTitle?: string;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")        // drop a file extension
    .replace(/^[\s\d._\-–—|)(]+/, "")        // drop list/ordering prefixes ("03 - ", "2.1 ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Component schemas, keyed by the normalized parent section title.
 *
 * Only kinds with a genuinely different shape need an entry. Anything absent
 * gets no parent-level section requirement and is judged by the content
 * validator that already understands it.
 */
const COMPONENT_SECTION_SCHEMAS: Record<string, string[]> = {
  "cover letter": ["Dear", "Subject", "Sincerely"],
  "quotation cover letter": ["Dear", "Subject", "Sincerely"],
};

export function resolveArtifactQualitySchema(input: {
  documentName: string | null | undefined;
  fileName: string | null | undefined;
  documentType: string | null | undefined;
  requiredSectionsByType: Record<string, string[]>;
}): ArtifactQualitySchema {
  const documentType = (input.documentType ?? "").trim();
  const parentSections = input.requiredSectionsByType[documentType] ?? [];
  const label = `${input.documentName ?? ""} ${input.fileName ?? ""}`;
  const normalizedLabel = normalize(label);
  const normalizedName = normalize(input.documentName ?? "");
  const normalizedFile = normalize(input.fileName ?? "");

  // A transmittal letter is a cover letter under any of its common names, and
  // it is a component whether or not the parent type happens to list it.
  if (/cover\s*[-_]?\s*letter|transmittal\s*letter|letter\s+of\s+transmittal/i.test(label)) {
    return {
      role: "COMPONENT",
      schemaKey: "COVER_LETTER",
      requiredSections: COMPONENT_SECTION_SCHEMAS["cover letter"],
      matchedSectionTitle: "Cover Letter",
      rationale: "Recognized as a cover/transmittal letter; validated against a letter schema rather than the parent submission's section list.",
    };
  }

  // The general rule: is this artifact named after one of its parent's own
  // sections? Longest title first, so "Technical Approach and Methodology"
  // wins over a hypothetical shorter "Methodology".
  const candidates = [...parentSections].sort((a, b) => normalize(b).length - normalize(a).length);
  for (const section of candidates) {
    const normalizedSection = normalize(section);
    if (!normalizedSection) continue;
    const isThisSection =
      normalizedName === normalizedSection
      || normalizedFile === normalizedSection
      || normalizedLabel === normalizedSection
      // "03 - Technical Approach and Methodology.docx" style artifacts.
      || normalizedName.endsWith(` ${normalizedSection}`)
      || normalizedFile.endsWith(` ${normalizedSection}`);
    if (!isThisSection) continue;
    return {
      role: "COMPONENT",
      schemaKey: `${documentType}::${section}`,
      requiredSections: COMPONENT_SECTION_SCHEMAS[normalizedSection] ?? [],
      matchedSectionTitle: section,
      rationale:
        `Artifact is named after "${section}", which ${documentType || "its document type"} declares as one of its own sections, `
        + "so it is a component of that submission rather than the submission itself. "
        + "Its content is judged by the rules for its own kind; requiring the parent's other sections would require a section to contain its siblings.",
    };
  }

  return {
    role: "COMPLETE_DOCUMENT",
    schemaKey: documentType,
    requiredSections: parentSections,
    rationale: documentType
      ? `Artifact is a complete ${documentType} and answers to that type's full section list.`
      : "Artifact has no document type; no parent section list applies.",
  };
}

// ─── Package role: what belongs in the CLIENT package ────────────────────────
//
// A second question with the same shape as the schema one above, and the same
// failure when it is answered by type alone.
//
// On 2026-09-20 the benchmark tender reported `requiredDocumentsTotal = 1`:
// the client asked for one file, Technical Proposal.pdf, and that file passed
// quality 100. The package was nevertheless refused with
//
//   [EXTRA_FILES]            Generated package contains non-required file(s):
//                            Technical Approach and Methodology.docx
//   [OUTSIDE_PLAN_DOCUMENTS] 1 generated document(s) are outside the confirmed
//                            submission plan: Technical Approach and Methodology.docx.
//
// because an internally materialized section draft had been marked a
// final-export candidate. An artifact the app produced for its own assembly
// became a client-package blocker.
//
// THE DISTINCTION THAT MATTERS. Not every unplanned artifact is innocent. A
// stray client-facing document that nobody authorized must still block — that
// is the whole point of the check. What must not block is an internal
// component: an artifact named after one of its parent submission's own
// sections, which the tender's file-naming instructions never asked for as a
// separate deliverable.
//
// So the tender's required file names remain the authority for the client
// package, and this function only classifies what each artifact IS.

export type PackageRole =
  /** Named by the tender/plan as a file to deliver. */
  | "PLANNED_DELIVERABLE"
  /** An internal section draft the app materialized for its own assembly. */
  | "INTERNAL_COMPONENT"
  /** Unplanned and NOT a recognizable component — still blocks. */
  | "UNPLANNED_CLIENT_FILE";

export type PackageRoleResolution = {
  role: PackageRole;
  rationale: string;
};

export function resolvePackageRole(input: {
  documentName: string | null | undefined;
  fileName: string | null | undefined;
  documentType: string | null | undefined;
  requiredSectionsByType: Record<string, string[]>;
  /** Exact file names the tender / confirmed plan asks to be delivered. */
  plannedDeliveryNames: string[];
}): PackageRoleResolution {
  const fileName = (input.fileName ?? "").trim();
  const planned = new Set(input.plannedDeliveryNames.map((n) => normalize(n)));
  const normalizedFile = normalize(fileName);
  const normalizedName = normalize(input.documentName ?? "");

  if (planned.has(normalizedFile) || planned.has(normalizedName)) {
    return { role: "PLANNED_DELIVERABLE", rationale: "Named by the confirmed plan as a file to deliver." };
  }

  // Classify on the FILE NAME, because the file name is what would go in the
  // package. A row's display `name` can be stale or inherited — an
  // "Annex-Extra.docx" carrying the display name "Cover Letter" is still an
  // unplanned annex, and treating it as a component would hide exactly the
  // unauthorized client-facing file this check exists to catch. The display
  // name is used only when there is no file name to judge.
  const schema = resolveArtifactQualitySchema({
    documentName: fileName ? null : input.documentName,
    fileName: input.fileName,
    documentType: input.documentType,
    requiredSectionsByType: input.requiredSectionsByType,
  });
  if (schema.role === "COMPONENT") {
    return {
      role: "INTERNAL_COMPONENT",
      rationale:
        `Not a planned delivery file, and named after "${schema.matchedSectionTitle}" — a section of its own submission. `
        + "It is internal assembly material, so it is excluded from the client package rather than blocking it.",
    };
  }

  return {
    role: "UNPLANNED_CLIENT_FILE",
    rationale:
      "Not a planned delivery file and not a recognizable section of its submission, so it is an unauthorized "
      + "client-facing file and must continue to block the package.",
  };
}
