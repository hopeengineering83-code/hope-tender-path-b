// Submission-plan item classifier (Gap 8 fix).
//
// PROBLEM
// ───────
// The submission-plan builder used to lift every requirement title into a
// "planned generated file" — including pure rules. That turned
// commercial-separation rules and submission-method rules into FAKE
// .docx/.pdf entries:
//   • "Email Recipients: Both Contacts Mandatory.docx"  ← a rule, not a file
//   • "Financial Proposal Exclusion: Technical Only at This Stage.docx"
//     ← a commercial-control rule, not a deliverable
//   • "Submission Format and Document Control.pdf"
//     ← an internal control row, not necessarily a submission output
//
// FIX
// ───
// Classify each candidate row into one of 6 categories:
//
//   REQUIRED_OUTPUT_FILE         — a real deliverable that the system
//                                  should generate or attach
//                                  (e.g. "Technical Proposal.pdf",
//                                  "Bid Bond Confirmation Letter")
//   FORM_TEMPLATE_TO_COMPLETE    — a tender-provided form/annex/schedule
//                                  the bidder must complete
//   ORIGINAL_EVIDENCE_ATTACHMENT — must be uploaded as-is from a vault
//                                  source (license, registration cert,
//                                  audited statements), NEVER generated
//   INTERNAL_COMPLIANCE_CONTROL  — a checklist row, not a file
//   SUBMISSION_RULE              — a process rule
//                                  (e.g. "must be submitted before noon")
//   COMMERCIAL_SEPARATION_RULE   — financial-vs-technical separation rule
//
// Only REQUIRED_OUTPUT_FILE and FORM_TEMPLATE_TO_COMPLETE should ever
// become planned generated/export files. The rest become compliance /
// checklist rows in the UI.

export type SubmissionPlanCategory =
  | "REQUIRED_OUTPUT_FILE"
  | "FORM_TEMPLATE_TO_COMPLETE"
  | "ORIGINAL_EVIDENCE_ATTACHMENT"
  | "INTERNAL_COMPLIANCE_CONTROL"
  | "SUBMISSION_RULE"
  | "COMMERCIAL_SEPARATION_RULE";

export type ClassifierInput = {
  title?: string | null;
  description?: string | null;
  requirementType?: string | null;
  /** When the regex extracted an exact required filename, treat as a deliverable. */
  exactFileName?: string | null;
};

export type ClassifierResult = {
  category: SubmissionPlanCategory;
  /** Why the classifier picked this category (for debug / UI tooltips). */
  rationale: string;
  /** Convenience flag — true ONLY for REQUIRED_OUTPUT_FILE / FORM_TEMPLATE_TO_COMPLETE. */
  shouldBePlannedFile: boolean;
};

// ─── Pattern tables ─────────────────────────────────────────────────

/** Pattern matches → category. Order matters: first match wins. */
const PATTERN_TABLE: Array<{ category: SubmissionPlanCategory; rationale: string; test: RegExp }> = [
  // Commercial separation rules — match BEFORE generic FINANCIAL keyword.
  {
    category: "COMMERCIAL_SEPARATION_RULE",
    rationale: "Title describes a financial-vs-technical separation rule, not a deliverable file.",
    test: /\b(financial\s+proposal\s+exclusion|financial\s+envelope\s+separat|financial\s+(\w+\s+){0,3}separate|separate\s+envelope|two[-\s]envelope|sealed\s+envelope.*(financial|commercial)|technical[-\s]only\s+at\s+this\s+stage|do\s+not\s+include\s+(price|financial)|technical\s+and\s+financial\s+(must\s+be\s+)?separat)/i,
  },
  // Submission rules — process/timing/recipient rules.
  {
    category: "SUBMISSION_RULE",
    rationale: "Title describes a submission process/timing/recipient rule, not a deliverable file.",
    test: /\b(both\s+contacts?\s+mandatory|email\s+recipients?\s*:\s*both|must\s+be\s+submitted\s+(by|before|no\s+later)|submit(ted)?\s+(by|before)\s+\d|deadline\s+(is|of|for)|copy\s+(to|both)|recipients?\s*:\s*both|cc\s+(both|all)|both\s+emails?)\b/i,
  },
  // Internal compliance controls — format/labelling/control rows.
  {
    category: "INTERNAL_COMPLIANCE_CONTROL",
    rationale: "Title describes an internal format/labelling/control rule, not a generated file.",
    test: /\b(submission\s+format\s+and\s+document\s+control|document\s+control\s+(rules?|sheet|register|matrix)|formatting\s+rules?|labelling\s+rules?|envelope\s+labelling|file\s+naming\s+convention|compliance\s+control\s+(sheet|register|matrix)|internal\s+(control|checklist))\b/i,
  },
  // Original evidence attachments — vault uploads, never generated.
  {
    category: "ORIGINAL_EVIDENCE_ATTACHMENT",
    rationale: "Title describes an evidence attachment that must be uploaded as the original document, not generated.",
    test: /\b(valid\s+business\s+licen[cs]e|business\s+licen[cs]e\s+(certificate|original|copy)|tax\s+clearance\s+certificate|audited\s+(financial\s+)?statements?|registration\s+certificate|incorporation\s+certificate|trade\s+licen[cs]e|professional\s+licen[cs]e|grade\s+certificate|tax\s+identification\s+(number|certificate)|tin\s+certificate|vat\s+certificate|certificate\s+of\s+(registration|incorporation|good\s+standing|tax)|ethiopian\s+registration|original\s+(license|certificate|registration))\b/i,
  },
  // Form templates — tender-provided forms the bidder fills.
  {
    category: "FORM_TEMPLATE_TO_COMPLETE",
    rationale: "Title describes a tender-provided form/schedule/annex the bidder must complete.",
    test: /\b(form\s+\d|schedule\s+\d|annex(ure)?\s+\d|appendix\s+\d|format\s+\d|attachment\s+\d|bid\s+form|tender\s+form|price\s+schedule|technical\s+schedule|expert\s+cv\s+form|cv\s+template|declaration\s+form|undertaking\s+form|integrity\s+pact|bidder\s+information\s+form|template\s+to\s+(complete|fill)|to\s+be\s+completed\s+by\s+(the\s+)?bidder)\b/i,
  },
  // Required output files — explicit "submit the X document" style.
  {
    category: "REQUIRED_OUTPUT_FILE",
    rationale: "Title describes a proposal/document the bidder must submit.",
    test: /\b(technical\s+proposal|financial\s+proposal|cover\s+letter|executive\s+summary|company\s+profile|methodology\s+document|work\s+plan\s+(document|chart)|implementation\s+plan|quality\s+assurance\s+plan|risk\s+management\s+plan|cv\s+package|expert\s+cvs?|project\s+experience\s+(dossier|portfolio)|bid\s+bond\s+(confirmation\s+letter|certificate)|power\s+of\s+attorney|joint\s+venture\s+agreement|consortium\s+agreement)\b/i,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

function combinedText(input: ClassifierInput): string {
  return `${input.title ?? ""} ${input.description ?? ""}`.trim();
}

function isProbablyDeliverable(input: ClassifierInput): boolean {
  // Has an explicit exactFileName extracted from "submit the file X.docx".
  if ((input.exactFileName ?? "").trim().length > 0) return true;
  // requirementType also signals deliverable-ness when the title is ambiguous.
  const t = (input.requirementType ?? "").toUpperCase();
  return ["FORM", "ANNEX", "SCHEDULE", "DECLARATION"].includes(t);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Classify a candidate submission-plan row.
 *
 * Resolution order:
 *   1. Run the pattern table (first hit wins). The table is ordered so
 *      rules (commercial separation, submission, internal control) match
 *      before evidence attachments and forms — which match before the
 *      generic "required output file" pattern.
 *   2. If nothing matches:
 *      a. exactFileName present OR requirementType is FORM/ANNEX/etc.
 *         → REQUIRED_OUTPUT_FILE (most-permissive default for explicit deliverables)
 *      b. otherwise → INTERNAL_COMPLIANCE_CONTROL (safest default — won't
 *         create a fake file from an unclear title).
 */
export function classifySubmissionPlanItem(input: ClassifierInput): ClassifierResult {
  const text = combinedText(input);
  if (text.length === 0) {
    return {
      category: "INTERNAL_COMPLIANCE_CONTROL",
      rationale: "Empty title and description — defaulting to internal compliance row (never a generated file).",
      shouldBePlannedFile: false,
    };
  }

  for (const entry of PATTERN_TABLE) {
    if (entry.test.test(text)) {
      const shouldBePlannedFile = entry.category === "REQUIRED_OUTPUT_FILE" || entry.category === "FORM_TEMPLATE_TO_COMPLETE";
      return { category: entry.category, rationale: entry.rationale, shouldBePlannedFile };
    }
  }

  // No pattern matched — fall back to type signals.
  if (isProbablyDeliverable(input)) {
    return {
      category: "REQUIRED_OUTPUT_FILE",
      rationale: "No rule/evidence/control pattern matched, but exactFileName or requirementType indicates a deliverable.",
      shouldBePlannedFile: true,
    };
  }

  return {
    category: "INTERNAL_COMPLIANCE_CONTROL",
    rationale: "No deliverable pattern matched — defaulting to internal compliance row to avoid inventing a file from an ambiguous title.",
    shouldBePlannedFile: false,
  };
}

/**
 * Convenience: returns true ONLY when the classifier confidently
 * decided the row should become a planned generated/export file.
 * Callers can use this to filter rows BEFORE constructing
 * SubmissionPlanFile entries.
 */
export function shouldRowBecomePlannedFile(input: ClassifierInput): boolean {
  return classifySubmissionPlanItem(input).shouldBePlannedFile;
}
