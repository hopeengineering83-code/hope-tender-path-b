// Package conformance — verifying the rules the SUBMISSION obeys, not the
// evidence the OWNER supplies.
//
// PROBLEM
// ───────
// The live tender showed two mandatory requirements stuck at "Partially
// verified", each with the subtitle "Automatically linked. The Engine will
// strengthen this requirement when more specific eligible evidence or
// validated output bytes become available.":
//
//   • "Submission in a Single PDF Technical File"   [Format]
//   • "Financial Proposal Omission"                 [Submission]
//
// Neither is a request for evidence. Both are RULES the package either obeys
// or breaks. Asking the owner to "strengthen the evidence" for them is asking
// for something that cannot exist: no company record, no CV, no licence and no
// tender source file can prove that our submission is one PDF, or that it
// contains no financial proposal.
//
// WHY THEY LANDED AT PARTIAL
// ──────────────────────────
// lib/engine/automatic-requirement-coverage.ts scores every requirement by
// TEXT SIMILARITY against candidate records. A prior fix narrowed these
// requirements to PACKAGE_FORMAT so they stopped accepting unrelated files
// (`Expert CVs.pdf.txt` had been "proving" the single-PDF rule at FULL
// support). That stopped the wrong answer, but the remaining artifact
// candidates are still scored by name similarity — and the name of a rule
// never closely matches the name of a document. The similarity score lands
// below the FULL threshold, so the row settles at PARTIAL for ever. The
// instrument is wrong, not the threshold.
//
// THE FIX
// ───────
// A package rule is verified by OBSERVING THE PACKAGE. This module turns the
// requirement text into a concrete, checkable proposition about the current
// export-candidate documents, evaluates it against those documents, and
// returns one of three verdicts:
//
//   SATISFIED        the package demonstrably obeys the rule
//   VIOLATED         the package demonstrably breaks it — a real blocker,
//                    named precisely, never silently passed
//   PENDING_PACKAGE  the package does not exist yet, so the rule is not yet
//                    decidable. This is a downstream automatic state, NOT an
//                    evidence gap and NOT something to ask the owner for.
//
// FAIL-CLOSED IS PRESERVED
// ────────────────────────
// SATISFIED is only ever returned from observed facts about real documents.
// A rule whose proposition this module cannot decide returns
// NOT_MACHINE_DECIDABLE and is never reported as met.
//
// ONE COPY OF EACH RULE
// ─────────────────────
// Envelope classification comes from submission-plan.ts `inferEnvelope`.
// Current-document selection comes from document-output-state.ts
// `filterFinalExportCandidateDocuments`. The financial-separation predicate
// comes from financial-separation-rule.ts. The packaging predicate comes from
// packaging-requirement-rule.ts. This module adds no private copy of any of
// them.

import { createHash } from "crypto";
import {
  filterFinalExportCandidateDocuments,
  isValidationPassed,
  type DocumentLike,
} from "./document-output-state";
import { inferEnvelope } from "./submission-plan";
import { statesFinancialSeparation } from "./financial-separation-rule";
import { isPackagingOrFormatRequirement } from "./packaging-requirement-rule";

export type PackageRuleFamily =
  | "FINANCIAL_SEPARATION"
  | "SINGLE_FILE_CONSOLIDATION"
  | "FILE_FORMAT"
  | "FILE_NAMING"
  | "NOT_MACHINE_DECIDABLE";

export type PackageConformanceStatus =
  | "SATISFIED"
  | "VIOLATED"
  | "PENDING_PACKAGE"
  | "NOT_MACHINE_DECIDABLE";

export type PackageConformanceVerdict = {
  /** False when the requirement is a normal evidence requirement. */
  applicable: boolean;
  family: PackageRuleFamily | null;
  status: PackageConformanceStatus;
  /** Human sentence naming exactly what was observed. */
  reason: string;
  /** The observed facts the verdict rests on, in a stable order. */
  observedFacts: string[];
  /** Stable digest of the observed package state; changes when the package changes. */
  factDigest: string;
};

export type ConformanceDocument = DocumentLike & {
  id: string;
  name?: string | null;
  exactFileName?: string | null;
  documentType?: string | null;
  format?: string | null;
  validationStatus?: string | null;
  contentSha256?: string | null;
  contentByteLength?: number | null;
};

export type PackageConformanceFacts = {
  /** All non-superseded generated document rows; narrowed canonically here. */
  documents: ConformanceDocument[];
  /** exactFileName of every item in the CONFIRMED build plan, when one exists. */
  plannedFileNames?: string[];
  /** True only when a source-verified Build Plan is confirmed. */
  planConfirmed?: boolean;
};

export type PackageRuleRequirement = {
  title?: string | null;
  description?: string | null;
  restrictions?: string | null;
  requirementType?: string | null;
  exactFileName?: string | null;
};

function normalise(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function requirementText(requirement: PackageRuleRequirement): string {
  return normalise(
    [requirement.title, requirement.description, requirement.restrictions]
      .filter(Boolean)
      .join(" "),
  );
}

function docLabel(doc: ConformanceDocument): string {
  return String(doc.exactFileName ?? doc.name ?? doc.id);
}

function docFormat(doc: ConformanceDocument): string {
  return String(doc.format ?? "").trim().toUpperCase();
}

function envelopeOf(doc: ConformanceDocument): string {
  return inferEnvelope(
    String(doc.documentType ?? ""),
    docLabel(doc),
    null,
  );
}

/**
 * Which envelope a consolidation/format rule is talking about. A rule that
 * names the technical proposal constrains the technical envelope only; a rule
 * that names no envelope constrains the whole submission.
 */
function scopedEnvelope(text: string): "TECHNICAL" | "FINANCIAL" | "ALL" {
  if (/\btechnical\b/.test(text)) return "TECHNICAL";
  if (/\bfinancial\b|\bprice\b|\bcommercial\b/.test(text)) return "FINANCIAL";
  return "ALL";
}

/** The file format a rule demands, when it names one. */
function demandedFormat(text: string): "PDF" | "DOCX" | "XLSX" | null {
  if (/\bpdf\b/.test(text)) return "PDF";
  if (/\b(?:docx?|word)\b/.test(text)) return "DOCX";
  if (/\b(?:xlsx|excel|spreadsheet)\b/.test(text)) return "XLSX";
  return null;
}

const SINGLE_FILE_PHRASES: RegExp[] = [
  /\b(?:single|one|1)\s+(?:consolidated\s+)?(?:pdf|file|document|volume)\b/,
  /\bsingle\s+(?:pdf|technical|financial)\b/,
  /\bconsolidated\s+into\s+(?:a\s+)?(?:single|one)\b/,
  /\b(?:combined?|merged?|compiled)\s+into\s+(?:a\s+|one\s+)?(?:single\s+)?(?:pdf|file|document)\b/,
  /\bas\s+(?:a\s+)?single\s+\w+\b/,
];

const FILE_FORMAT_PHRASES: RegExp[] = [
  /\b(?:submitted?|submission|provided?|uploaded?|saved?)\s+in\s+(?:pdf|docx?|word|excel|xlsx)\s*(?:format)?\b/,
  /\b(?:pdf|docx?|xlsx)\s+format\s+(?:only|is\s+required|required)\b/,
  /\bformat\s*:\s*(?:pdf|docx?|word|excel)\b/,
  /\bsearchable\s+pdf\b/,
  /\bnon[- ]?editable\s+(?:pdf|format)\b/,
];

const FILE_NAMING_PHRASES: RegExp[] = [
  /\bfile\s+nam(?:e|ing)\b/,
  /\bnaming\s+(?:convention|format|rule)\b/,
  /\bnamed?\s+(?:exactly\s+)?as\s+follows\b/,
];

/**
 * Classify a package rule into the family that decides HOW it is checked.
 * Returns null when the requirement is a normal evidence requirement.
 */
export function classifyPackageRule(
  requirement: PackageRuleRequirement,
): PackageRuleFamily | null {
  const text = requirementText(requirement);
  if (!text) return null;

  // Financial separation is tested first: it is a submission rule that also
  // uses envelope words the packaging predicate would claim.
  if (statesFinancialSeparation(text) || statesFinancialSeparation(requirement.title)) {
    return "FINANCIAL_SEPARATION";
  }
  if (!isPackagingOrFormatRequirement(requirement)) return null;

  if (SINGLE_FILE_PHRASES.some((rx) => rx.test(text))) return "SINGLE_FILE_CONSOLIDATION";
  if (FILE_FORMAT_PHRASES.some((rx) => rx.test(text))) return "FILE_FORMAT";
  if (FILE_NAMING_PHRASES.some((rx) => rx.test(text))) return "FILE_NAMING";

  // Page limits, font sizes, hard-copy counts, binding and envelope marking are
  // real rules that stored bytes cannot decide. Never claimed as met.
  return "NOT_MACHINE_DECIDABLE";
}

function digestOf(facts: string[]): string {
  return createHash("sha256").update(facts.join("\n"), "utf8").digest("hex");
}

function describe(docs: ConformanceDocument[]): string[] {
  return docs
    .map((doc) => `${docLabel(doc)}|${docFormat(doc) || "UNKNOWN"}|${envelopeOf(doc)}|${isValidationPassed(doc.validationStatus) ? "VALIDATED" : "UNVALIDATED"}`)
    .sort();
}

function verdict(
  family: PackageRuleFamily,
  status: PackageConformanceStatus,
  reason: string,
  observedFacts: string[],
): PackageConformanceVerdict {
  return {
    applicable: true,
    family,
    status,
    reason,
    observedFacts,
    factDigest: digestOf([family, status, ...observedFacts]),
  };
}

function checkFinancialSeparation(
  current: ConformanceDocument[],
  observed: string[],
): PackageConformanceVerdict {
  if (current.length === 0) {
    return verdict(
      "FINANCIAL_SEPARATION",
      "PENDING_PACKAGE",
      "No current export-candidate document exists yet, so the package cannot be observed. This rule is satisfied by the shape of the package and needs no owner-supplied evidence.",
      observed,
    );
  }
  const financial = current.filter((doc) => envelopeOf(doc) === "FINANCIAL");
  if (financial.length > 0) {
    return verdict(
      "FINANCIAL_SEPARATION",
      "VIOLATED",
      `The tender requires the financial proposal to be omitted or sent separately, but the current package still carries ${financial.length} financial-envelope document(s): ${financial.map(docLabel).join(", ")}. Remove them from this package before export.`,
      observed,
    );
  }
  return verdict(
    "FINANCIAL_SEPARATION",
    "SATISFIED",
    `The current package contains ${current.length} export-candidate document(s) and none of them belongs to the financial envelope, so the financial-separation rule is obeyed by construction.`,
    observed,
  );
}

function checkSingleFileConsolidation(
  requirement: PackageRuleRequirement,
  current: ConformanceDocument[],
  observed: string[],
): PackageConformanceVerdict {
  const text = requirementText(requirement);
  const scope = scopedEnvelope(text);
  const format = demandedFormat(text);
  const inScope = scope === "ALL"
    ? current
    : current.filter((doc) => envelopeOf(doc) === scope);
  const scopeLabel = scope === "ALL" ? "submission" : `${scope.toLowerCase()} envelope`;

  if (inScope.length === 0) {
    return verdict(
      "SINGLE_FILE_CONSOLIDATION",
      "PENDING_PACKAGE",
      `No current export-candidate document exists in the ${scopeLabel} yet, so the single-file rule cannot be observed. It is satisfied by the produced package and needs no owner-supplied evidence.`,
      observed,
    );
  }
  if (inScope.length > 1) {
    return verdict(
      "SINGLE_FILE_CONSOLIDATION",
      "VIOLATED",
      `The tender requires one consolidated file for the ${scopeLabel}, but the current package holds ${inScope.length}: ${inScope.map(docLabel).join(", ")}. They must be consolidated into a single file before export.`,
      observed,
    );
  }
  const only = inScope[0]!;
  if (format && docFormat(only) !== format) {
    return verdict(
      "SINGLE_FILE_CONSOLIDATION",
      "VIOLATED",
      `The tender requires a single ${format} file for the ${scopeLabel}, but ${docLabel(only)} is ${docFormat(only) || "of unknown format"}.`,
      observed,
    );
  }
  return verdict(
    "SINGLE_FILE_CONSOLIDATION",
    "SATISFIED",
    `The ${scopeLabel} resolves to exactly one export-candidate file, ${docLabel(only)}${format ? ` in ${format} format` : ""}, so the single-file rule is obeyed by construction.`,
    observed,
  );
}

function checkFileFormat(
  requirement: PackageRuleRequirement,
  current: ConformanceDocument[],
  observed: string[],
): PackageConformanceVerdict {
  const text = requirementText(requirement);
  const format = demandedFormat(text);
  if (!format) {
    return verdict(
      "FILE_FORMAT",
      "NOT_MACHINE_DECIDABLE",
      "The requirement states a format rule but does not name a file format this check can compare against.",
      observed,
    );
  }
  const scope = scopedEnvelope(text);
  const inScope = scope === "ALL"
    ? current
    : current.filter((doc) => envelopeOf(doc) === scope);
  const scopeLabel = scope === "ALL" ? "submission" : `${scope.toLowerCase()} envelope`;

  if (inScope.length === 0) {
    return verdict(
      "FILE_FORMAT",
      "PENDING_PACKAGE",
      `No current export-candidate document exists in the ${scopeLabel} yet, so the ${format} format rule cannot be observed. It is satisfied by the produced package and needs no owner-supplied evidence.`,
      observed,
    );
  }
  const wrong = inScope.filter((doc) => docFormat(doc) !== format);
  if (wrong.length > 0) {
    return verdict(
      "FILE_FORMAT",
      "VIOLATED",
      `The tender requires ${format} for the ${scopeLabel}, but ${wrong.length} current document(s) are not ${format}: ${wrong.map((doc) => `${docLabel(doc)} (${docFormat(doc) || "unknown"})`).join(", ")}.`,
      observed,
    );
  }
  return verdict(
    "FILE_FORMAT",
    "SATISFIED",
    `Every current export-candidate document in the ${scopeLabel} is ${format}, so the format rule is obeyed by construction.`,
    observed,
  );
}

function checkFileNaming(
  current: ConformanceDocument[],
  facts: PackageConformanceFacts,
  observed: string[],
): PackageConformanceVerdict {
  // The confirmed Build Plan carries the exact file names derived from the
  // tender source. A package whose documents all carry a planned name obeys
  // the tender's naming rule; nothing else can decide it.
  if (!facts.planConfirmed || !facts.plannedFileNames || facts.plannedFileNames.length === 0) {
    return verdict(
      "FILE_NAMING",
      "PENDING_PACKAGE",
      "No confirmed Build Plan is available yet, so the tender's exact file names are not established. Naming is applied automatically from the confirmed plan and needs no owner-supplied evidence.",
      observed,
    );
  }
  if (current.length === 0) {
    return verdict(
      "FILE_NAMING",
      "PENDING_PACKAGE",
      "No current export-candidate document exists yet, so file naming cannot be observed.",
      observed,
    );
  }
  const planned = new Set(
    facts.plannedFileNames.map((name) => normalise(name)).filter(Boolean),
  );
  const unplanned = current.filter((doc) => !planned.has(normalise(docLabel(doc))));
  if (unplanned.length > 0) {
    return verdict(
      "FILE_NAMING",
      "VIOLATED",
      `${unplanned.length} current document(s) do not carry a file name from the confirmed Build Plan: ${unplanned.map(docLabel).join(", ")}.`,
      observed,
    );
  }
  return verdict(
    "FILE_NAMING",
    "SATISFIED",
    `All ${current.length} current export-candidate document(s) carry exact file names from the confirmed Build Plan, so the naming rule is obeyed by construction.`,
    observed,
  );
}

/**
 * Decide whether the current package obeys the rule this requirement states.
 *
 * Returns `applicable: false` for every ordinary evidence requirement, which
 * leaves the normal evidence-selection path untouched.
 */
export function evaluatePackageConformance(
  requirement: PackageRuleRequirement,
  facts: PackageConformanceFacts,
): PackageConformanceVerdict {
  const family = classifyPackageRule(requirement);
  if (!family) {
    return {
      applicable: false,
      family: null,
      status: "NOT_MACHINE_DECIDABLE",
      reason: "Not a package rule; ordinary evidence selection applies.",
      observedFacts: [],
      factDigest: "",
    };
  }

  const current = filterFinalExportCandidateDocuments(facts.documents ?? []);
  const observed = describe(current);

  if (family === "FINANCIAL_SEPARATION") return checkFinancialSeparation(current, observed);
  if (family === "SINGLE_FILE_CONSOLIDATION") return checkSingleFileConsolidation(requirement, current, observed);
  if (family === "FILE_FORMAT") return checkFileFormat(requirement, current, observed);
  if (family === "FILE_NAMING") return checkFileNaming(current, facts, observed);

  return verdict(
    "NOT_MACHINE_DECIDABLE",
    "NOT_MACHINE_DECIDABLE",
    "This packaging rule (page limits, fonts, hard-copy counts, binding or envelope marking) cannot be decided from the stored package bytes. It is never reported as met, and no owner-supplied evidence can prove it either.",
    observed,
  );
}
