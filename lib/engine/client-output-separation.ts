/**
 * Client Output vs Internal Review Separation
 *
 * Creates two explicit outputs:
 *   - internalReviewModel: scoring, evidence gaps, self-score, readiness
 *     checklist, unsupported-claim control, and bid-team actions.
 *   - clientProposalModel: only tender-required or professionally appropriate
 *     client-facing content.
 *
 * Do NOT allow internal terms into the client proposal unless the tender
 * explicitly requests them.
 *
 * The authoritative finalisation order:
 *   1. assemble grounded content
 *   2. separate internal diagnostics
 *   3. apply tender-required client-section allowlist
 *   4. validate claims and cross-references
 *   5. remove placeholders and internal tokens
 *   6. verify appendix references
 *   7. rebuild final section order and TOC
 *   8. render the client document
 *
 * No content injector may run after the final client sanitiser and TOC
 * rebuild.
 */

// ─── Internal terms that must never appear in client output ─────────────────

export const FORBIDDEN_INTERNAL_TERMS = [
  "Bid-Team Action",
  "Proposal Self-Score",
  "predicted score",
  "win probability",
  "evaluator simulation",
  "unsupported-claim control",
  "evidence-gap register",
  "readiness checklist",
  "internal review notes",
  "auto-repair",
  "fallback language",
  "application diagnostics",
] as const;

/**
 * Patterns for forbidden internal terms (case-insensitive).
 */
export const FORBIDDEN_INTERNAL_PATTERNS: RegExp[] = [
  /bid[- ]?team[- ]?action/gi,
  /proposal[- ]?self[- ]?score/gi,
  /predicted\s+score/gi,
  /win\s+probability/gi,
  /evaluator\s+simulation/gi,
  /unsupported[- ]claim\s+control/gi,
  /evidence[- ]gap\s+register/gi,
  /readiness\s+checklist/gi,
  /internal\s+review\s+notes?/gi,
  /auto[- ]?repair/gi,
  /fallback\s+language/gi,
  /application\s+diagnostics/gi,
];

// ─── Types ──────────────────────────────────────────────────────────────────

export type InternalReviewContent = {
  /** The internal scoring model (self-score, predicted score, etc.). */
  scoring: {
    selfScore: number | null;
    predictedScore: number | null;
    winProbability: number | null;
  };
  /** Evidence gaps and unsupported claims. */
  evidenceGaps: Array<{ claim: string; reason: string }>;
  /** Readiness checklist items. */
  readinessChecklist: Array<{ item: string; done: boolean }>;
  /** Bid-team actions. */
  bidTeamActions: Array<{ action: string; owner: string; dueDate: string | null }>;
  /** Internal review notes. */
  reviewNotes: string[];
  /** Evaluator simulation results. */
  evaluatorSimulation: string | null;
};

export type ClientProposalContent = {
  /** The tender title. */
  title: string;
  /** The client/procuring entity. */
  client: string;
  /** The proposal sections (only tender-required or professionally appropriate). */
  sections: Array<{ heading: string; body: string }>;
  /** The appendix register. */
  appendices: Array<{ letter: string; title: string; content: string }>;
  /** The final rendered text (after sanitiser + TOC rebuild). */
  renderedText: string;
};

// ─── Finalisation order ─────────────────────────────────────────────────────

export const FINALISATION_ORDER = [
  "assemble_grounded_content",
  "separate_internal_diagnostics",
  "apply_client_section_allowlist",
  "validate_claims_and_cross_references",
  "remove_placeholders_and_internal_tokens",
  "verify_appendix_references",
  "rebuild_section_order_and_toc",
  "render_client_document",
] as const;

export type FinalisationStep = (typeof FINALISATION_ORDER)[number];

// ─── Sanitiser ──────────────────────────────────────────────────────────────

/**
 * Remove all internal terms from client-facing text.
 *
 * This is the FINAL sanitiser — no content injector may run after this.
 * The function strips:
 *   - All forbidden internal terms (case-insensitive).
 *   - Placeholder tokens ([TBD], [NAME], [DATE], etc.).
 *   - AI provider names and model references.
 *   - Internal markers (INTERNAL:, DO NOT EXPORT, etc.).
 *
 * Returns the cleaned text and a list of removed terms (for audit logging).
 */
export function sanitizeClientOutput(text: string): {
  cleanedText: string;
  removedTerms: Array<{ term: string; count: number }>;
} {
  if (!text) return { cleanedText: text, removedTerms: [] };

  let cleaned = text;
  const removedTerms: Array<{ term: string; count: number }> = [];

  // Remove forbidden internal terms
  for (const pattern of FORBIDDEN_INTERNAL_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      const term = matches[0];
      const existing = removedTerms.find((r) => r.term.toLowerCase() === term.toLowerCase());
      if (existing) {
        existing.count += matches.length;
      } else {
        removedTerms.push({ term, count: matches.length });
      }
      cleaned = cleaned.replace(pattern, "");
    }
  }

  // Remove placeholder tokens
  cleaned = cleaned.replace(/\[(?:TBD|NAME|DATE|PLACEHOLDER|INSERT|TODO|FIXME)\]/gi, "");

  // Remove AI provider names
  cleaned = cleaned.replace(/\b(?:Anthropic|Claude|OpenAI|ChatGPT|GPT-[34]\w*|Gemini|Google\s+AI)\b/gi, "");

  // Remove internal markers
  cleaned = cleaned.replace(/INTERNAL[\s:]+[^\n]*/gi, "");
  cleaned = cleaned.replace(/INTERNAL_REVIEW_ONLY/gi, "");
  cleaned = cleaned.replace(/\[INTERNAL[^\]]*\]/gi, "");
  cleaned = cleaned.replace(/DO\s+NOT\s+EXPORT/gi, "");

  // Remove "as an AI" / "I am an AI" phrasing
  cleaned = cleaned.replace(/as\s+an\s+ai[,:]?/gi, "");
  cleaned = cleaned.replace(/i\s+am\s+an\s+ai[,:]?/gi, "");

  // Clean up extra whitespace
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/^\s+|\s+$/gm, "");

  return { cleanedText: cleaned, removedTerms };
}

/**
 * Check if a piece of text contains any forbidden internal terms.
 * Returns the list of violations (empty if clean).
 */
export function findInternalTermViolations(text: string): Array<{ term: string; match: string }> {
  if (!text) return [];
  const violations: Array<{ term: string; match: string }> = [];
  for (const pattern of FORBIDDEN_INTERNAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push({ term: match[0], match: match[0] });
    }
  }
  return violations;
}

/**
 * Verify that the finalisation order is correct — no content injector
 * runs after the final client sanitiser and TOC rebuild.
 *
 * @param steps - The list of finalisation steps that were executed, in order.
 * @returns True if the order is valid (sanitiser before TOC rebuild, no
 *   injectors after).
 */
export function verifyFinalisationOrder(steps: FinalisationStep[]): {
  valid: boolean;
  reason: string | null;
} {
  // The sanitiser is "remove_placeholders_and_internal_tokens"
  // The TOC rebuild is "rebuild_section_order_and_toc"
  // No injector may run after these two.

  const sanitiserIdx = steps.indexOf("remove_placeholders_and_internal_tokens");
  const tocIdx = steps.indexOf("rebuild_section_order_and_toc");
  const renderIdx = steps.indexOf("render_client_document");

  if (sanitiserIdx === -1) {
    return { valid: false, reason: "Finalisation order is missing the client sanitiser step." };
  }
  if (tocIdx === -1) {
    return { valid: false, reason: "Finalisation order is missing the TOC rebuild step." };
  }
  if (renderIdx === -1) {
    return { valid: false, reason: "Finalisation order is missing the render step." };
  }

  // Sanitiser must come before TOC rebuild
  if (sanitiserIdx > tocIdx) {
    return { valid: false, reason: "Client sanitiser must run before TOC rebuild." };
  }
  // TOC rebuild must come before render
  if (tocIdx > renderIdx) {
    return { valid: false, reason: "TOC rebuild must run before final render." };
  }

  // No step after the sanitiser can be an injector
  // (injectors are: assemble_grounded_content, separate_internal_diagnostics,
  // apply_client_section_allowlist, validate_claims_and_cross_references)
  const injectors: FinalisationStep[] = [
    "assemble_grounded_content",
    "separate_internal_diagnostics",
    "apply_client_section_allowlist",
    "validate_claims_and_cross_references",
  ];
  for (let i = sanitiserIdx + 1; i < steps.length; i++) {
    if (injectors.includes(steps[i])) {
      return {
        valid: false,
        reason: `Content injector "${steps[i]}" runs after the client sanitiser — no content injector may run after the final sanitiser and TOC rebuild.`,
      };
    }
  }

  return { valid: true, reason: null };
}
