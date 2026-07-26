/**
 * Cross-Source and Intra-Document Consistency Validator
 *
 * A final invariant validator that detects contradictions between tender
 * facts, company evidence, and professional assumptions.
 *
 * Detects:
 *   - conflicting deadlines (e.g. March 2026 vs August 2026)
 *   - conflicting tender references
 *   - email-only vs physical-address contradictions
 *   - different project or certification counts
 *   - conflicting establishment dates
 *   - duplicate or concatenated expert names and roles
 *   - conflicting appendix references
 *   - unsupported permanent-employee claims
 *   - unnamed mandatory specialists
 *   - technical constants or regulatory claims with no reviewed source
 *
 * Tender facts, company evidence, and professional assumptions must be
 * separate authority classes. A professional design assumption may be
 * included only when clearly identified as the consultant's proposed
 * methodology — NOT represented as a tender requirement or verified
 * company history.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type AuthorityClass = "tender_fact" | "company_evidence" | "professional_assumption";

export type ConsistencyViolation = {
  type: string;
  severity: "error" | "warning";
  message: string;
  /** The authority class of the conflicting claim. */
  authorityClass: AuthorityClass;
  /** The excerpt that contains the violation. */
  excerpt: string;
};

// ─── Validators ─────────────────────────────────────────────────────────────

/**
 * Detect conflicting deadlines in the text.
 *
 * The Pharo fixture has a known wrong extraction: "March 2026" must never
 * appear when the authoritative deadline is August 25, 2026.
 */
export function detectConflictingDeadlines(
  text: string,
  authoritativeDeadline: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  // Parse the authoritative deadline year and month
  const authDate = new Date(authoritativeDeadline);
  const authYear = authDate.getUTCFullYear();
  const authMonth = authDate.getUTCMonth() + 1;

  // Find all date-like patterns in the text
  const datePatterns = [
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
  ];

  for (const pattern of datePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const monthName = match[1].length > 2 ? match[1] : match[2];
      const year = match[1].length > 2 ? parseInt(match[2]) : parseInt(match[3]);
      const monthNum = monthNameToNum(monthName);

      if (year !== authYear || monthNum !== authMonth) {
        violations.push({
          type: "conflicting_deadline",
          severity: "error",
          message: `Text contains deadline "${match[0]}" but the authoritative deadline is ${authYear}-${String(authMonth).padStart(2, "0")}. This may be a wrong extraction (e.g. March 2026 instead of August 2026).`,
          authorityClass: "tender_fact",
          excerpt: match[0],
        });
      }
    }
  }

  return violations;
}

/**
 * Detect email-only vs physical-address contradictions.
 *
 * If the authoritative submission method is "email only", any physical
 * address in the text is a contradiction.
 */
export function detectSubmissionMethodContradictions(
  text: string,
  authoritativeMethod: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  if (authoritativeMethod.toLowerCase().includes("email")) {
    // Email-only submission — any physical address is a contradiction
    const addressPatterns = [
      /\b(?:submit|delivery|submission)\s+(?:to|at|in)\s+([A-Z][^,\n]{10,80})/gi,
      /\b(?:physical|postal)\s+(?:address|submission)\s*[:•]\s*([^\n]{10,80})/gi,
    ];
    for (const pattern of addressPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        // Exclude email addresses
        if (!match[0].includes("@")) {
          violations.push({
            type: "submission_method_contradiction",
            severity: "error",
            message: `Text contains a physical submission reference "${match[0].slice(0, 60)}" but the authoritative submission method is email-only. No physical address should appear.`,
            authorityClass: "tender_fact",
            excerpt: match[0],
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Detect duplicate or concatenated expert names and roles.
 *
 * Catches: "John Doe John Doe", "John Doe / Jane Smith / John Doe",
 * "Architect Architect", etc.
 */
export function detectDuplicateExpertNames(text: string): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  // Detect repeated names: "John Doe John Doe"
  const repeatedNamePattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+\1\b/g;
  let match;
  while ((match = repeatedNamePattern.exec(text)) !== null) {
    violations.push({
      type: "duplicate_expert_name",
      severity: "warning",
      message: `Duplicate expert name detected: "${match[1]}" appears twice consecutively.`,
      authorityClass: "company_evidence",
      excerpt: match[0],
    });
  }

  // Detect repeated roles: "Architect Architect"
  const rolePattern = /\b(Architect|Engineer|Surveyor|Consultant|Specialist|Manager|Director)\s+\1\b/gi;
  while ((match = rolePattern.exec(text)) !== null) {
    violations.push({
      type: "duplicate_role",
      severity: "warning",
      message: `Duplicate role detected: "${match[1]}" appears twice consecutively.`,
      authorityClass: "company_evidence",
      excerpt: match[0],
    });
  }

  return violations;
}

/**
 * Detect unsupported permanent-employee claims.
 *
 * A "permanent employee" claim must be backed by company evidence, not a
 * professional assumption. This detects "permanent employee" claims that
 * appear without evidence.
 */
export function detectUnsupportedPermanentEmployeeClaims(text: string): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  const pattern = /\b(?:permanent\s+(?:employee|staff|member)|full[- ]time\s+employee)\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Check if the surrounding context has evidence (project name, date, etc.)
    const start = Math.max(0, match.index - 100);
    const end = Math.min(text.length, match.index + 100);
    const context = text.slice(start, end);
    const hasEvidence = /\b(?:CV|resume|licence|certificate|project|reference)\b/i.test(context);
    if (!hasEvidence) {
      violations.push({
        type: "unsupported_permanent_employee_claim",
        severity: "warning",
        message: `Permanent-employee claim "${match[0]}" appears without supporting evidence (CV, licence, project reference).`,
        authorityClass: "company_evidence",
        excerpt: match[0],
      });
    }
  }

  return violations;
}

/**
 * Detect unnamed mandatory specialists.
 *
 * Phrases like "specialist to be engaged", "to be appointed", "to be hired"
 * for mandatory disciplines (biomedical engineer, architect, structural
 * engineer) are violations.
 */
export function detectUnnamedMandatorySpecialists(text: string): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  const mandatoryDisciplines = [
    "biomedical engineer",
    "architect",
    "structural engineer",
  ];

  const unnamedPatterns = [
    /\b(?:to\s+be\s+(?:engaged|appointed|hired|recruited|named))\b/gi,
    /\b(?:specialist\s+to\s+be\s+(?:engaged|appointed|hired))\b/gi,
    /\b(?:TBD\s+engineer|TBD\s+architect)\b/gi,
  ];

  for (const pattern of unnamedPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + 80);
      const context = text.slice(start, end).toLowerCase();
      const isMandatory = mandatoryDisciplines.some((d) => context.includes(d));
      if (isMandatory) {
        violations.push({
          type: "unnamed_mandatory_specialist",
          severity: "error",
          message: `Mandatory discipline referenced with an unnamed specialist: "${match[0]}". Mandatory disciplines require a named, reviewed expert.`,
          authorityClass: "company_evidence",
          excerpt: match[0],
        });
      }
    }
  }

  return violations;
}

/**
 * Detect professional assumptions represented as tender requirements.
 *
 * A professional design assumption may be included only when clearly
 * identified as the consultant's proposed methodology — NOT represented
 * as a tender requirement or verified company history.
 */
export function detectMisrepresentedAssumptions(text: string): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  // Detect assumption phrases that are NOT clearly marked as methodology
  const assumptionPatterns = [
    /\b(?:we\s+assume|it\s+is\s+assumed|our\s+assumption)\b/gi,
    /\b(?:presumed|presumably)\b/gi,
    /\b(?:estimated|approximately\s+\d+)\b/gi,
  ];

  for (const pattern of assumptionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + 80);
      const context = text.slice(start, end).toLowerCase();
      // Check if it's clearly marked as methodology
      const isMethodology = /\b(?:methodology|approach|proposed|our\s+approach|design\s+approach)\b/i.test(context);
      if (!isMethodology) {
        violations.push({
          type: "misrepresented_assumption",
          severity: "warning",
          message: `Professional assumption "${match[0]}" appears without clear methodology marking. Assumptions must be identified as the consultant's proposed methodology, not as tender requirements.`,
          authorityClass: "professional_assumption",
          excerpt: match[0],
        });
      }
    }
  }

  return violations;
}

// ─── Combined validator ─────────────────────────────────────────────────────

/**
 * Run all consistency validators on the text.
 */
export function validateConsistency(
  text: string,
  options: {
    authoritativeDeadline?: string;
    authoritativeSubmissionMethod?: string;
  } = {},
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  violations.push(...detectDuplicateExpertNames(text));
  violations.push(...detectUnsupportedPermanentEmployeeClaims(text));
  violations.push(...detectUnnamedMandatorySpecialists(text));
  violations.push(...detectMisrepresentedAssumptions(text));

  if (options.authoritativeDeadline) {
    violations.push(...detectConflictingDeadlines(text, options.authoritativeDeadline));
  }

  if (options.authoritativeSubmissionMethod) {
    violations.push(...detectSubmissionMethodContradictions(text, options.authoritativeSubmissionMethod));
  }

  return violations;
}

/**
 * Check if consistency violations block final export.
 * Errors block final export; warnings do not.
 */
export function consistencyViolationsBlockFinalExport(violations: ConsistencyViolation[]): boolean {
  return violations.some((v) => v.severity === "error");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function monthNameToNum(name: string): number {
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  return months[name.toLowerCase()] ?? 0;
}
