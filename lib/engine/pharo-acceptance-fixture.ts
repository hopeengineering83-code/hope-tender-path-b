/**
 * Pharo Acceptance Fixture — deterministic tender authority facts for the
 * Architectural Consultancy Services for Pharo Health Ethiopia Specialty
 * Medical Center tender.
 *
 * This fixture encodes the acceptance requirements so tests can verify
 * extraction, authority classification, criterion coverage, scope
 * crosswalk, appendix register, and client-output integrity without
 * reading uploaded proposal or tender files.
 *
 * Every fact here is the authoritative truth. The generated client
 * proposal must never contradict these facts.
 */

// ─── Authoritative facts ────────────────────────────────────────────────────

export const PHARO_TITLE =
  "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center";

export const PHARO_CLIENT = "Pharo Ventures";

export const PHARO_LOCATION = "Addis Ababa, Ethiopia";

/** Submission method: email only. No physical address, no portal. */
export const PHARO_SUBMISSION_METHOD = "email";

/**
 * Deadline: August 25, 2026, 5:00 PM Addis Ababa Time (EAT, UTC+3).
 *
 * The ISO form is used for storage/comparison. The human-readable form is
 * used for display and client-facing output.
 *
 * "March 2026" is a KNOWN WRONG extraction — the generated client proposal
 * must never contain a March 2026 submission deadline.
 */
export const PHARO_DEADLINE_ISO = "2026-08-25T17:00:00+03:00";

export const PHARO_DEADLINE_DISPLAY = "August 25, 2026, 5:00 PM Addis Ababa Time";

export const PHARO_SUBMISSION_EMAILS = [
  "edessalegn@pharoventures.com",
  "fgetachewdesta@pharoventures.com",
] as const;

export const PHARO_EMAIL_SUBJECT = "Technical Proposal for Pharo Ventures";

/** Required client deliverable: Technical Proposal.pdf */
export const PHARO_REQUIRED_DELIVERABLE = "Technical Proposal.pdf";

/** DOCX is the internal editable source before PDF finalisation. */
export const PHARO_INTERNAL_EDITABLE_FORMAT = "DOCX";

/** Financial proposal: NOT required. */
export const PHARO_FINANCIAL_PROPOSAL_REQUIRED = false;

/** Tender reference: not provided. */
export const PHARO_TENDER_REFERENCE = null;

/** Physical address/portal: not provided (email-only submission). */
export const PHARO_PHYSICAL_ADDRESS = null;

/** Proposal validity: not provided. */
export const PHARO_PROPOSAL_VALIDITY = null;

/** Bid bond: not stated — NOT a blocker. */
export const PHARO_BID_BOND = null;

/** Pre-bid meeting: not stated — NOT a blocker. */
export const PHARO_PRE_BID_MEETING = null;

/** Page limit: not stated — NOT a blocker. */
export const PHARO_PAGE_LIMIT = null;

/** Evaluation weights: not provided — NOT a blocker. */
export const PHARO_EVALUATION_WEIGHTS = null;

// ─── Five unweighted evaluation criteria ────────────────────────────────────

export type PharoCriterion = {
  id: string;
  name: string;
  /** Weight status: "Not provided" — never assign equal or estimated weights. */
  weightStatus: "Not provided";
  /** The proposal section or table that answers this criterion. */
  proposalSection: string;
};

export const PHARO_EVALUATION_CRITERIA: PharoCriterion[] = [
  {
    id: "criterion-1-healthcare-experience",
    name: "Relevant healthcare project experience",
    weightStatus: "Not provided",
    proposalSection: "Section 3 — Relevant Healthcare Project Experience",
  },
  {
    id: "criterion-2-portfolio-quality",
    name: "Quality and relevance of portfolio",
    weightStatus: "Not provided",
    proposalSection: "Section 4 — Portfolio Quality and Relevance",
  },
  {
    id: "criterion-3-technical-understanding",
    name: "Technical understanding of healthcare facility design",
    weightStatus: "Not provided",
    proposalSection: "Section 5 — Technical Understanding and Methodology",
  },
  {
    id: "criterion-4-team-strength",
    name: "Strength of professional team",
    weightStatus: "Not provided",
    proposalSection: "Section 6 — Proposed Professional Team",
  },
  {
    id: "criterion-5-compliance",
    name: "Compliance with submission requirements",
    weightStatus: "Not provided",
    proposalSection: "Section 7 — Compliance with Submission Requirements",
  },
];

// ─── Six scope workstreams ──────────────────────────────────────────────────

export type PharoScopeWorkstream = {
  id: string;
  name: string;
  /** The proposal section that covers this workstream. */
  proposalSection: string;
};

export const PHARO_SCOPE_WORKSTREAMS: PharoScopeWorkstream[] = [
  {
    id: "scope-1-facility-assessment",
    name: "Facility identification and technical assessment",
    proposalSection: "Section 5.1 — Facility Identification and Technical Assessment",
  },
  {
    id: "scope-2-architectural-design",
    name: "Conceptual and detailed architectural design",
    proposalSection: "Section 5.2 — Conceptual and Detailed Architectural Design",
  },
  {
    id: "scope-3-engineering-coordination",
    name: "Engineering coordination",
    proposalSection: "Section 5.3 — Engineering Coordination",
  },
  {
    id: "scope-4-regulatory-compliance",
    name: "Regulatory compliance and approvals",
    proposalSection: "Section 5.4 — Regulatory Compliance and Approvals",
  },
  {
    id: "scope-5-renovation-planning",
    name: "Renovation planning and implementation oversight",
    proposalSection: "Section 5.5 — Renovation Planning and Implementation Oversight",
  },
  {
    id: "scope-6-close-out",
    name: "Project close-out support",
    proposalSection: "Section 5.6 — Project Close-out Support",
  },
];

// ─── Fourteen required healthcare disciplines ───────────────────────────────

export type PharoDiscipline = {
  id: string;
  name: string;
  /** The functional area this discipline serves. */
  functionalArea: string;
  /** Whether an unnamed "specialist to be engaged" satisfies this requirement. */
  allowsUnnamedSubcontractor: boolean;
};

export const PHARO_DISCIPLINES: PharoDiscipline[] = [
  // Functional areas
  { id: "disc-emergency", name: "Emergency", functionalArea: "Emergency Department", allowsUnnamedSubcontractor: false },
  { id: "disc-opd", name: "OPD", functionalArea: "Outpatient Department", allowsUnnamedSubcontractor: false },
  { id: "disc-inpatient", name: "In-patient", functionalArea: "Inpatient Wards", allowsUnnamedSubcontractor: false },
  { id: "disc-laboratory", name: "Laboratory", functionalArea: "Laboratory", allowsUnnamedSubcontractor: false },
  { id: "disc-imaging", name: "Imaging/Radiology", functionalArea: "Imaging and Radiology", allowsUnnamedSubcontractor: false },
  { id: "disc-pharmacy", name: "Pharmacy", functionalArea: "Pharmacy", allowsUnnamedSubcontractor: false },
  // Engineering disciplines
  { id: "disc-architecture", name: "Architecture", functionalArea: "Architectural Design", allowsUnnamedSubcontractor: false },
  { id: "disc-structural", name: "Structural engineering", functionalArea: "Structural Engineering", allowsUnnamedSubcontractor: false },
  { id: "disc-mechanical", name: "Mechanical systems", functionalArea: "Mechanical Systems", allowsUnnamedSubcontractor: false },
  { id: "disc-electrical", name: "Electrical systems", functionalArea: "Electrical Systems", allowsUnnamedSubcontractor: false },
  { id: "disc-plumbing", name: "Plumbing/sanitary systems", functionalArea: "Plumbing and Sanitary Systems", allowsUnnamedSubcontractor: false },
  { id: "disc-medical-gas", name: "Medical gas", functionalArea: "Medical Gas Systems", allowsUnnamedSubcontractor: false },
  { id: "disc-it-telehealth", name: "IT and telehealth", functionalArea: "IT and Telehealth", allowsUnnamedSubcontractor: false },
  // Biomedical engineer — MANDATORY, no unnamed specialist
  { id: "disc-biomedical", name: "Biomedical engineering", functionalArea: "Biomedical Engineering", allowsUnnamedSubcontractor: false },
];

// ─── Appendix register ──────────────────────────────────────────────────────

export type PharoAppendix = {
  letter: string;
  title: string;
  content: string;
};

export const PHARO_APPENDICES: PharoAppendix[] = [
  {
    letter: "A",
    title: "Company Profile and Registration Documents",
    content: "Certificate of Incorporation, TIN, VAT, Business Licence, Company Profile",
  },
  {
    letter: "B",
    title: "Project Testimony Letters and Contracts",
    content: "Client reference letters, contract excerpts, completion certificates",
  },
  {
    letter: "C",
    title: "Expert CVs, Credentials and Licences",
    content: "CVs, academic credentials, professional licences, certifications",
  },
  {
    letter: "D",
    title: "Selected Drawings and Photographs",
    content: "Architectural drawings, photographs of completed projects",
  },
  {
    letter: "E",
    title: "Company Manuals and Audited Documents",
    content: "QA/QC manuals, audited financial statements, ISO certificates",
  },
];

// ─── Forbidden content in client proposal ───────────────────────────────────

/**
 * The generated client proposal must NEVER contain these. Each entry is a
 * pattern that, if matched in the client-facing output, is a violation.
 */
export const PHARO_FORBIDDEN_CLIENT_CONTENT: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /March\s+2026/i, reason: "March 2026 is a wrong extraction — the deadline is August 25, 2026" },
  { pattern: /bid[-\s]*team[-\s]*action/i, reason: "Internal term 'Bid-Team Action' must not appear in client proposal" },
  { pattern: /proposal\s*self[- ]?score/i, reason: "Internal term 'Proposal Self-Score' must not appear in client proposal" },
  { pattern: /win\s+probability/i, reason: "Internal term 'Win Probability' must not appear in client proposal" },
  { pattern: /evaluator\s+simulation/i, reason: "Internal term 'Evaluator Simulation' must not appear in client proposal" },
  { pattern: /unsupported[- ]claim\s+control/i, reason: "Internal term 'Unsupported-Claim Control' must not appear in client proposal" },
  { pattern: /evidence[- ]gap\s+register/i, reason: "Internal term 'Evidence-Gap Register' must not appear in client proposal" },
  { pattern: /readiness\s+checklist/i, reason: "Internal term 'Readiness Checklist' must not appear in client proposal" },
  { pattern: /internal\s+review\s+note/i, reason: "Internal term 'Internal Review Notes' must not appear in client proposal" },
  { pattern: /auto[- ]?repair/i, reason: "Internal term 'Auto-Repair' must not appear in client proposal" },
  { pattern: /fallback\s+language/i, reason: "Internal term 'Fallback Language' must not appear in client proposal" },
  { pattern: /application\s+diagnostic/i, reason: "Internal term 'Application Diagnostics' must not appear in client proposal" },
];

/**
 * The generated client proposal must NEVER contain an invented:
 * - physical Pharo submission address (email-only submission)
 * - tender or company proposal reference presented as tender authority
 * - proposal validity (not provided)
 * - financial prices or financial proposal (not required)
 * - bid bond, portal, phone or contact person (not stated)
 */
export const PHARO_FORBIDDEN_INVENTED_FACTS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /Pharo\s+(?:office|address|street|road|building|HQ|headquarters)/i, reason: "Invented physical Pharo submission address — submission is email-only" },
  { pattern: /proposal\s+validity\s+(?:is|of|period|duration)/i, reason: "Invented proposal validity — not provided in tender" },
  { pattern: /(?:bid\s+bond|tender\s+security|guarantee)\s+(?:amount|fee|ETB|USD|birr)/i, reason: "Invented bid bond amount — not stated in tender" },
  { pattern: /submission\s+portal\s+URL/i, reason: "Invented submission portal — submission is email-only" },
  { pattern: /contact\s+(?:phone|telephone|mobile)\s*[:•]/i, reason: "Invented contact phone — not stated in tender" },
];

// ─── Combined fixture object ────────────────────────────────────────────────

export const PHARO_ACCEPTANCE_FIXTURE = {
  title: PHARO_TITLE,
  client: PHARO_CLIENT,
  location: PHARO_LOCATION,
  submissionMethod: PHARO_SUBMISSION_METHOD,
  deadlineIso: PHARO_DEADLINE_ISO,
  deadlineDisplay: PHARO_DEADLINE_DISPLAY,
  submissionEmails: [...PHARO_SUBMISSION_EMAILS],
  emailSubject: PHARO_EMAIL_SUBJECT,
  requiredDeliverable: PHARO_REQUIRED_DELIVERABLE,
  internalEditableFormat: PHARO_INTERNAL_EDITABLE_FORMAT,
  financialProposalRequired: PHARO_FINANCIAL_PROPOSAL_REQUIRED,
  tenderReference: PHARO_TENDER_REFERENCE,
  physicalAddress: PHARO_PHYSICAL_ADDRESS,
  proposalValidity: PHARO_PROPOSAL_VALIDITY,
  bidBond: PHARO_BID_BOND,
  preBidMeeting: PHARO_PRE_BID_MEETING,
  pageLimit: PHARO_PAGE_LIMIT,
  evaluationWeights: PHARO_EVALUATION_WEIGHTS,
  evaluationCriteria: PHARO_EVALUATION_CRITERIA,
  scopeWorkstreams: PHARO_SCOPE_WORKSTREAMS,
  disciplines: PHARO_DISCIPLINES,
  appendices: PHARO_APPENDICES,
  forbiddenClientContent: PHARO_FORBIDDEN_CLIENT_CONTENT,
  forbiddenInventedFacts: PHARO_FORBIDDEN_INVENTED_FACTS,
} as const;

export type PharoAcceptanceFixture = typeof PHARO_ACCEPTANCE_FIXTURE;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simulated source text for the Pharo tender. Tests use this to verify
 * extraction logic without reading uploaded files.
 */
export const PHARO_SOURCE_TEXT = `
${PHARO_TITLE}

Client: ${PHARO_CLIENT}
Location: ${PHARO_LOCATION}

Submission Method: Email only
Submission Emails: ${PHARO_SUBMISSION_EMAILS.join(", ")}
Email Subject: ${PHARO_EMAIL_SUBJECT}
Submission Deadline: ${PHARO_DEADLINE_DISPLAY}

Required Deliverable: ${PHARO_REQUIRED_DELIVERABLE}

Financial Proposal: Not required

Evaluation Criteria:
1. Relevant healthcare project experience
2. Quality and relevance of portfolio
3. Technical understanding of healthcare facility design
4. Strength of professional team
5. Compliance with submission requirements

Scope of Work:
1. Facility identification and technical assessment
2. Conceptual and detailed architectural design
3. Engineering coordination
4. Regulatory compliance and approvals
5. Renovation planning and implementation oversight
6. Project close-out support

Functional Areas: Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy

Required Disciplines: Architecture, Structural engineering, Mechanical systems,
Electrical systems, Plumbing/sanitary systems, Medical gas, IT and telehealth,
Biomedical engineering
` as const;

/**
 * Verify a piece of client-facing text against the Pharo forbidden-content
 * rules. Returns an array of violations (empty if clean).
 */
export function findPharoClientContentViolations(text: string): Array<{ reason: string; match: string }> {
  const violations: Array<{ reason: string; match: string }> = [];
  for (const { pattern, reason } of [...PHARO_FORBIDDEN_CLIENT_CONTENT, ...PHARO_FORBIDDEN_INVENTED_FACTS]) {
    const match = text.match(pattern);
    if (match) {
      violations.push({ reason, match: match[0] });
    }
  }
  return violations;
}

/**
 * Verify that a deadline string matches the Pharo acceptance deadline.
 * Returns true if the deadline is correct (August 25, 2026, 5:00 PM EAT).
 */
export function isPharoDeadlineCorrect(deadlineStr: string | Date | null): boolean {
  if (!deadlineStr) return false;
  const expected = new Date(PHARO_DEADLINE_ISO);
  const actual = deadlineStr instanceof Date ? deadlineStr : new Date(deadlineStr);
  if (isNaN(actual.getTime())) return false;
  // Compare as ISO strings (preserves timezone)
  return actual.toISOString() === expected.toISOString();
}

/**
 * Verify that a set of submission emails matches the Pharo acceptance emails.
 * Order-independent. Returns true if both emails are present (and no extras).
 */
export function isPharoEmailsCorrect(emails: string[]): boolean {
  if (emails.length !== PHARO_SUBMISSION_EMAILS.length) return false;
  const expected = new Set(PHARO_SUBMISSION_EMAILS);
  return emails.every((e) => expected.has(e as (typeof PHARO_SUBMISSION_EMAILS)[number]));
}
