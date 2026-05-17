export type QuickDraftInput = {
  tenderTitle: string;
  clientName: string;
  tenderDescription: string;
  requirementLines: string[];
  companyName: string;
  companyProfile: string;
  serviceLines: string;
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/([A-Z])\s(?=[A-Z]\s[A-Z])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isPollutedLabel(value?: string | null): boolean {
  const label = clean(value).toLowerCase();
  return !label
    || label.length < 2
    || label.length > 120
    || /^references\s*(\(|where|$)/i.test(label)
    || /^photos?\s+or\s+drawings?/i.test(label)
    || /^technical\s+approach/i.test(label)
    || /^understanding\s+of\s+the\s+assignment/i.test(label)
    || /^discipline\s+and\s+long[- ]term\s+commitment/i.test(label)
    || /references \(where available\)|photos? or drawings?|proposed design methodology|headquarters|relationship|full name|prepared for|compilation date|data source|complete master file|for-pro\s*fit arm/i.test(label);
}

function cleanLabel(value?: string | null, fallback = "Client"): string {
  const cleaned = clean(value)
    .replace(/\b(photos?|drawings?|technical approach|understanding of the assignment|proposed design methodology|references\s*\(?where available\)?|appendix|section [a-d])\b.*$/i, "")
    .replace(/\b(headquarters|relationship|full name|prepared for|compilation date|data source)\b.*$/i, "")
    .replace(/["“”]+/g, "")
    .trim();

  if (isPollutedLabel(cleaned)) return fallback;
  return cleaned;
}

// ─── Universal-tender fix ─────────────────────────────────────────────
// Pre-fix this module hardcoded "Pharo Ventures" / "Pharo Foundation"
// as fallback client names and a Pharo-specific healthcare title as a
// fallback tender title. That biased the quick-draft toward the
// original benchmark tender — every non-Pharo tender that fell through
// to this fallback rendered with "Pharo" in the client field. Now both
// inference functions use ONLY generic patterns (explicit-label match
// + organisation-keyword scan + scope-verb match) so the same engine
// works for any sector.

const ORGANISATION_KEYWORD = /\b(Ministry|Authority|Agency|Commission|Corporation|Organi[sz]ation|Foundation|University|Institute|Department|Company|Limited|Ltd|Inc|PLC|Group|Consortium|Union|Federation|Bank|Trust|Fund|Ventures?|Council|Bureau)\b/;

function inferClientName(input: QuickDraftInput): string {
  const direct = cleanLabel(input.clientName, "");
  if (direct && !isPollutedLabel(direct)) return direct;

  const context = `${input.clientName}\n${input.tenderTitle}\n${input.tenderDescription}\n${input.requirementLines.join("\n")}`;
  const explicit = context.match(/(?:Client|Issued by|Issuing Authority|Procuring Entity|Employer|Contracting Authority|Beneficiary|Implementing Agency|Executing Agency)\s*:\s*([^\n|.;]{3,90})/i);
  if (explicit?.[1] && !isPollutedLabel(explicit[1])) return cleanLabel(explicit[1], "Client");

  // Last-resort: pick the first line that contains an organisation
  // keyword (Ministry, Authority, Foundation, etc.). Generic enough to
  // work for any sector or country.
  const lines = context.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.length < 3 || line.length > 120) continue;
    if (isPollutedLabel(line)) continue;
    if (ORGANISATION_KEYWORD.test(line)) return cleanLabel(line, "Client");
  }

  return "Client";
}

function inferTenderTitle(input: QuickDraftInput): string {
  const direct = cleanLabel(input.tenderTitle, "");
  if (direct && !isPollutedLabel(direct)) return direct;

  const context = `${input.tenderTitle}\n${input.tenderDescription}\n${input.requirementLines.join("\n")}`;
  const explicit = context.match(/(?:Tender Title|Assignment Title|Project Title|Procurement Title|Contract Title|Subject)\s*:\s*([^\n|]{8,160})/i);
  if (explicit?.[1] && !isPollutedLabel(explicit[1])) return cleanLabel(explicit[1], "Technical Proposal");

  // Scope-verb inference — common across all tender types.
  const scope = context.match(/(?:Consultancy Services for|Services for|Design (?:of|and) Supervision of|Supply of|Procurement of|Construction of|Rehabilitation of|Feasibility Study for|Capacity Building for|Technical Assistance to|Implementation of|Assessment of|Evaluation of)\s+([^\n|.;]{8,160})/i);
  if (scope?.[0] && !isPollutedLabel(scope[0])) {
    return cleanLabel(`Technical Proposal for ${scope[0].trim()}`, "Technical Proposal");
  }

  return "Technical Proposal";
}

function truncate(value: string, max = 2600): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function buildQuickDraftBenchmarkPrompt(input: QuickDraftInput): string {
  const clientName = inferClientName(input);
  const tenderTitle = inferTenderTitle(input);
  const requirements = input.requirementLines.length
    ? input.requirementLines.slice(0, 28).map((line) => `- ${truncate(line, 260)}`).join("\n")
    : "- Requirements not yet extracted. The proposal should confirm detailed requirements before final submission.";

  return `You are a senior technical proposal writer. Write a clean benchmark-style technical proposal draft in markdown based only on the provided information.

Rules:
- Do not invent projects, experts, values, awards, certifications, licences, clients or dates.
- Do not copy messy OCR/extracted text directly into the proposal.
- Convert messy tender text into clean bidder-facing interpretation.
- If evidence is missing, write clean source-evidence confirmation actions.
- No financial offer unless explicitly requested.
- Use #, ## and bullet lists.

Required structure:
# Cover Letter
# Technical Proposal
# Table of Contents
# Executive Summary
# SECTION A: COMPANY PROFILE
## A.1 Company Background
## A.2 Core Areas of Expertise
## A.3 Proposed Team and CV Evidence
# SECTION B: RELEVANT EXPERIENCE
## B.1 Comparable Project Evidence
## B.2 Project Evidence to Attach
# SECTION C: TECHNICAL APPROACH
## C.1 Understanding of the Assignment
## C.2 Scope-by-Scope Methodology
## C.3 Quality Assurance and Submission Control
# SECTION D: ADDITIONAL INFORMATION
## D.1 Value to the Client
## D.2 Appendix Register
# Declaration

Tender title: ${tenderTitle}
Client: ${clientName}
Company: ${input.companyName}
Service lines: ${input.serviceLines || "Not specified"}

Clean tender/context summary:
${truncate(input.tenderDescription, 4200)}

Extracted requirements:
${requirements}

Company profile evidence:
${truncate(input.companyProfile, 3200)}

Now write a polished, evaluator-facing technical proposal draft. It should be usable as an intake draft, not the final DOCX package.`;
}

export function buildQuickDraftFallback(input: QuickDraftInput, reason: "AI_DISABLED" | "AI_UNAVAILABLE"): string {
  const clientName = inferClientName(input);
  const tenderTitle = inferTenderTitle(input);
  const notice = "> Intake draft generated by the local benchmark proposal engine. Produce the final DOCX through the full tender engine after evidence selection and validation.";

  const requirements = input.requirementLines.length
    ? input.requirementLines.slice(0, 18).map((line) => `- ${truncate(line, 260)}`).join("\n")
    : "- Source-evidence confirmation: run tender analysis and confirm detailed requirements before final submission.";

  return [
    notice,
    "",
    "# Cover Letter",
    `To: ${clientName}`,
    `${input.companyName} submits this technical proposal draft for ${tenderTitle}. The final proposal should lead with verified comparable project evidence, selected CVs, and tender-specific methodology before submission.`,
    "",
    "# Technical Proposal",
    `Prepared by: ${input.companyName}`,
    `Client: ${clientName}`,
    "",
    "# Table of Contents",
    "1. Executive Summary",
    "2. Section A: Company Profile",
    "3. Section B: Relevant Experience",
    "4. Section C: Technical Approach",
    "5. Section D: Additional Information",
    "6. Declaration",
    "",
    "# Executive Summary",
    `${input.companyName} should position this response around evidence-first delivery: reviewed company capability, selected experts/CVs, comparable project references, scope-specific methodology, compliance controls, and appendix evidence.`,
    "",
    "# SECTION A: COMPANY PROFILE",
    "## A.1 Company Background",
    truncate(input.companyProfile, 1200) || `${input.companyName} company profile evidence should be confirmed from the company knowledge vault.`,
    "## A.2 Core Areas of Expertise",
    input.serviceLines || "Source-evidence confirmation: confirm service lines from reviewed company profile records.",
    "## A.3 Proposed Team and CV Evidence",
    "Source-evidence confirmation: select and map reviewed experts/CVs to tender scope, prior comparable work, and delivery responsibilities.",
    "",
    "# SECTION B: RELEVANT EXPERIENCE",
    "## B.1 Comparable Project Evidence",
    "Source-evidence confirmation: lead with the strongest verified comparable projects, including client, location, scope, value where supported, services and relevance.",
    "## B.2 Project Evidence to Attach",
    "Attach or confirm testimony letters, contracts, completion evidence, project photos/drawings, certificates and client references where required.",
    "",
    "# SECTION C: TECHNICAL APPROACH",
    "## C.1 Understanding of the Assignment",
    truncate(input.tenderDescription, 1400) || "The assignment should be interpreted from the uploaded tender documents and confirmed against the source files.",
    "## C.2 Scope-by-Scope Methodology",
    requirements,
    "## C.3 Quality Assurance and Submission Control",
    "Apply evidence verification, document control, compliance review, appendix checks, file-name validation, and final approval before submission.",
    "",
    "# SECTION D: ADDITIONAL INFORMATION",
    "## D.1 Value to the Client",
    "The proposal should show reduced delivery risk through verified evidence, relevant team capability, clear methodology, and compliance discipline.",
    "## D.2 Appendix Register",
    "- Company registration/licence and legal evidence",
    "- CVs and credentials",
    "- Comparable project evidence",
    "- Certificates/testimony/completion evidence/photos/drawings where applicable",
    "- Required declarations and tender forms",
    "",
    "# Declaration",
    "This draft must be reviewed against the original tender and source evidence before final submission.",
  ].join("\n");
}
