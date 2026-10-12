// Truthful guidance for surfaces that must tell the owner what to do next.
//
// GAP A
// ─────
// The Bid Strategy panel's fallback read:
//
//   "Bid strategy requires reliable extraction and analysis. Uploading a
//    clearer copy of the source re-runs both automatically."
//
// The second half is false. Replacing a source file re-runs extraction — that
// part is automatic and durable — but AI Analyze is an authenticated manual
// action on /api/tenders/[id]/manual-ai-analyze, and Run Engine is another on
// /api/tenders/[id]/engine. Neither is queued by an upload. An owner who
// believed that sentence uploaded a cleaner scan and then waited for an
// analysis nobody had asked for.
//
// The workflow contract, stated once:
//
//   upload → automatic byte validation → automatic durable extraction
//          → MANUAL AI Analyze → MANUAL Run Engine
//          → automatic matching, Build Plan, generation, validation,
//            finalization, reconciliation → Final ZIP
//
// Every sentence below respects both manual gates. No string in this module
// may claim that AI Analyze or Run Engine happens on its own.

/**
 * Which of the three upstream conditions is currently unmet. Ordered: an
 * unreadable source makes the analysis question moot, and a missing analysis
 * makes the Engine question moot.
 */
export type ManualGateReason =
  /** Extraction failed, is corrupted, needs OCR, or is too weak to trust. */
  | "EXTRACTION_UNRELIABLE"
  /** Extraction is fine; AI Analyze has not run, failed, or is stale. */
  | "AI_ANALYZE_REQUIRED"
  /** AI Analyze is current; the Engine has not run for this revision. */
  | "RUN_ENGINE_REQUIRED";

export type ManualGateGuidance = {
  reason: ManualGateReason;
  /** The single sentence shown to the owner. */
  message: string;
  /** Stable code for clients that want to route to the right control. */
  nextAction: "UPLOAD_CLEARER_SOURCE" | "RUN_AI_ANALYZE" | "RUN_ENGINE";
};

const GUIDANCE: Record<ManualGateReason, ManualGateGuidance> = {
  EXTRACTION_UNRELIABLE: {
    reason: "EXTRACTION_UNRELIABLE",
    message:
      "Upload a clearer source file. Source extraction will run automatically. When extraction is complete, run AI Analyze.",
    nextAction: "UPLOAD_CLEARER_SOURCE",
  },
  AI_ANALYZE_REQUIRED: {
    reason: "AI_ANALYZE_REQUIRED",
    message:
      "Extraction is usable but there is no current AI analysis for this source revision. Run AI Analyze.",
    nextAction: "RUN_AI_ANALYZE",
  },
  RUN_ENGINE_REQUIRED: {
    reason: "RUN_ENGINE_REQUIRED",
    message: "AI Analyze is current for this source revision. Run Engine to continue.",
    nextAction: "RUN_ENGINE",
  },
};

/**
 * Pick the guidance for the first unmet condition.
 *
 * Callers pass what they already know. Nothing here queries the database or
 * decides eligibility — this module only chooses words.
 */
export function manualGateGuidance(input: {
  extractionReliable: boolean;
  analysisCurrent: boolean;
  engineRunForCurrentRevision?: boolean;
}): ManualGateGuidance {
  if (!input.extractionReliable) return GUIDANCE.EXTRACTION_UNRELIABLE;
  if (!input.analysisCurrent) return GUIDANCE.AI_ANALYZE_REQUIRED;
  if (input.engineRunForCurrentRevision === false) return GUIDANCE.RUN_ENGINE_REQUIRED;
  return GUIDANCE.AI_ANALYZE_REQUIRED;
}

export function manualGateGuidanceFor(reason: ManualGateReason): ManualGateGuidance {
  return GUIDANCE[reason];
}

/** Every message this module can emit — used by the regression test. */
export const ALL_MANUAL_GATE_MESSAGES: string[] = Object.values(GUIDANCE).map((g) => g.message);

/**
 * Phrasings that assert a manual gate runs on its own. Kept here so the
 * regression test and any future audit script read from one list rather than
 * each growing their own copy.
 */
export const FALSE_AUTOMATION_PATTERNS: RegExp[] = [
  /re-?runs? both automatically/i,
  /automatically re-?runs?/i,
  /automatically runs? (?:AI Analyze|Run Engine|the Engine)/i,
  /(?:AI Analyze|Run Engine)[^.]{0,40}\b(?:runs?|re-?runs?|start(?:s|ed)?)\b[^.]{0,20}automatically/i,
  /analysis (?:runs?|will run|re-?runs?) automatically/i,
];

/** True when `text` claims a manual gate happens automatically. */
export function claimsFalseAutomation(text: string): boolean {
  return FALSE_AUTOMATION_PATTERNS.some((pattern) => pattern.test(text));
}
