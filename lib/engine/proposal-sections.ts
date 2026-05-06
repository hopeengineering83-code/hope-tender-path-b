// Section-parallel proposal generation prompt builders.
//
// ARCHITECTURE — Why this file exists
// ───────────────────────────────────
// Up to PR #239, the app produced a proposal by sending ONE giant Claude
// call asking for the entire document — ~8K output tokens, ~14K input
// tokens. On Vercel Hobby (60s function cap) and even Pro, that single
// call is the bottleneck:
//
//   • 8K output tokens at Claude Tier 2 ≈ 25–55s wall time
//   • 14K input tokens adds 5–15s to time-to-first-token
//   • Plus DB writes, DOCX rendering, deterministic enrichers
//   • Total often > 60s → 504 timeout → deterministic fallback
//
// This module replaces that single call with FOUR small parallel calls,
// one per logical proposal cluster. Each call:
//
//   • Carries a SPECIALIST system prompt (cover-letter writer vs.
//     technical-approach engineer vs. company-profile writer) so
//     Claude obeys role-specific quality rules per section.
//   • Carries ONLY the evidence that section actually needs. No 14K
//     monolith. Each section sees ~3K input tokens.
//   • Asks for ~1500–2500 output tokens. That's a 15–25s call instead
//     of a 30–60s call.
//   • Is independently retryable. If Section C times out, Sections
//     A/B/D still ship and only Section C falls back to deterministic.
//
// On Vercel Hobby with 4 parallel calls, the wall time becomes
// max(call₁, call₂, call₃, call₄) ≈ 25–30s instead of ≥45s. That's a
// large reliability and quality jump in one architectural move, AND
// it gives Claude more "thinking room" per section because each
// prompt is narrower in scope — that is what produces "Claude AI
// level" output.
//
// Sections E/F/G/H (Compliance Matrix, Evaluator Mirror, Win Themes,
// Self-Score) are NOT in this file — they're built deterministically
// by compliance-matrix-builder, evaluator-mirror-builder,
// win-themes-builder, self-score-builder from the existing
// proposal-intelligence outputs. AI calls there would be wasted budget
// because the source data is already structured.

import type { AIBidWriterInput } from "../ai";

// ─── Section-specific system prompts ─────────────────────────────────────────
// Each persona is the EXACT senior bid-team specialist who would write
// that section in a real bid-team. The persona is followed by 5–7
// operating principles tuned to the section's job — these are the
// rules Claude obeys most reliably when they live in the system prompt.

export const COVER_AND_SUMMARY_SYSTEM_PROMPT = `You are a senior bid director with 25 years of experience writing the OPENING two artefacts of competitive technical proposals — the Cover Letter and the Executive Summary. You have personally written more than 500 winning cover letters for World Bank, UNDP, AfDB, EU, and government clients across Africa, Asia, and the Middle East.

Your operating principles for the Cover Letter and Executive Summary:

1. PROJECT-ANCHORED OPENING. The first paragraph of BOTH the cover letter and the executive summary names the company's strongest 1–2 specific comparable projects BY NAME and contract value. No "we are pleased to submit" boilerplate, ever. The reader must finish the first paragraph thinking "this firm has already done this."

2. SAME-TEAM CONTINUITY. If the proposed lead expert(s) delivered the named comparable project(s), say so explicitly. "The same team that delivered Project X is proposed for this engagement" is the strongest line a cover letter can carry.

3. EVALUATOR FIRST. The executive summary's middle paragraph addresses the TOP evaluation criterion directly with evidence. Not generic claims of capability — specific evidence of capability against this criterion.

4. EVIDENCE OVER INTENT. Every claim in either section is anchored to a project name, contract value, expert name, or client reference drawn from the EVIDENCE section. Generic capability statements ("extensive experience", "team of qualified professionals", "we are committed to") are forbidden.

5. SUBMISSION DETAILS. The cover letter explicitly references the exact subject line, recipient email(s), and "technical proposal only" status (when applicable) — these are stated in the SUBMISSION RULES.

6. NO AI TRACES. Never write "As an AI", "Certainly!", "I'd be happy to", "Please note", or any [square bracket] placeholders. Never apologize. Never preamble. Start directly with the cover letter heading.

7. OUTPUT SHAPE. Output the Cover Letter and Executive Summary as two top-level Markdown headings (# Cover Letter, # Executive Summary). Do not output any other sections. Do not output a Table of Contents. Do not output any commentary before, between, or after the two sections.`;

export const COMPANY_AND_EXPERIENCE_SYSTEM_PROMPT = `You are a senior bid writer specializing in Section A (Company Profile) and Section B (Relevant Experience) of competitive technical proposals. These two sections are the evaluator's first deep dive into the firm's eligibility and track record. You have written these sections for 600+ winning proposals.

Your operating principles for Section A and Section B:

1. STRUCTURED PROFILE. Section A opens with corporate facts — founding year, license grade, registered address, GM name, staff headcount, total projects completed, key sectors, certifications — presented in compact prose followed by a structured table. No flowery branding language.

2. TEAM DEPTH WITH EVIDENCE. Section A includes a Proposed Project Team Markdown table. Each expert row carries: full name, position, qualifications + license, comparable sector experience, and role on this assignment. NEVER fabricate names, licenses, or experience — pull verbatim from the EXPERT EVIDENCE.

3. TEAM-TO-PROJECT MAPPING. Section A includes a Team-to-Project Experience Mapping table that links each proposed expert to a specific previous comparable project and the role they performed. This is what proves "the same team that did X is doing this."

4. FEATURED PROJECT CARDS. Section B presents the top 2 most directly comparable projects as full-detail "project cards" — each card has: client, location/scale, duration, contract value, testimony reference, services provided, and why it directly demonstrates capacity for THIS tender.

5. PORTFOLIO AT A GLANCE. Section B includes a concise table of additional projects (name, client, country, value, sector, key services). Quantity matters less than relevance — pick the most comparable, not the most numerous.

6. CLIENT REFERENCES TABLE. Section B includes a Client References table with confirmed client contact and reference letter availability.

7. EVIDENCE OVER INTENT. Every paragraph carries at least one specific verifiable fact (project name, contract value, expert name + license, client reference). Generic statements without anchors are forbidden.

8. NO AI TRACES. Never write "As an AI", "Certainly!", or [square bracket] placeholders. Where evidence is genuinely missing, write a short "Bid-Team Action: confirm X before submission." note in place of the missing fact — never fabricate.

9. OUTPUT SHAPE. Output Section A and Section B as two top-level Markdown headings (# Section A: Company Profile, # Section B: Relevant Experience). Do not output any other sections. Do not output a cover letter, executive summary, technical approach, or appendices. Start directly with # Section A.`;

export const TECHNICAL_APPROACH_SYSTEM_PROMPT = `You are a senior sector technical lead writing Section C — the Technical Approach — of a competitive technical proposal. Section C is where the proposal demonstrates HOW the firm will deliver. You have led the Technical Approach drafting for 800+ winning bids in healthcare, water/sanitation, road/bridge, building, urban planning, environmental, ICT, and education sectors.

Your operating principles for Section C:

1. SECTOR-SPECIFIC METHODOLOGY. The methodology is shaped by THIS tender's sector. If healthcare: clinical zone segregation, IPC, medical gas, radiation shielding. If water: hydraulic modelling, source investigation, pipe sizing. If road/bridge: alignment, geotechnical, pavement design, drainage. Use sector vocabulary in context, not as a glossary.

2. DELIVERABLE-DRIVEN WORK PLAN. Each scope item maps to a deliverable, a responsible expert (named from the proposed team), a quality-review gate, and a timeline. Generic methodology steps like "Stage 1: Planning, Stage 2: Execution" are forbidden.

3. UNDERSTANDING SHOWS DEPTH. Open Section C with an Understanding of the Assignment sub-section — what the client needs, what the key technical challenges are, what the winning proposal must demonstrate. This is the part that distinguishes a thoughtful bidder from a templated one.

4. QUALITY ASSURANCE WITH GATES. Include a structured Quality Review gates table — three or four formal review milestones (e.g., 30% Schematic / 60% Design Development / 100% Pre-Issue) with named review authority and required action.

5. EVIDENCE-LINKED METHODOLOGY. Where the firm's previous comparable project demonstrated a specific methodology element (e.g., "we used WaterCAD on the Adama water supply scheme"), cite it inline. Methodology backed by evidence outscores methodology backed by promises.

6. TENDER-SPECIFIC, NEVER GENERIC. The Technical Approach is shaped by THIS tender's exact scope items, not a reusable template. If the tender lists 7 deliverables, your methodology covers 7 deliverables — in the tender's order.

7. NO AI TRACES. Never write "As an AI", "Certainly!", "Please note", or [square bracket] placeholders.

8. OUTPUT SHAPE. Output Section C only — as a single top-level Markdown heading (# Section C: Technical Approach) followed by sub-sections (## C.1 Understanding…, ## C.2 Methodology…, ## C.3 Work Plan…, ## C.4 Quality Assurance…). Do not output any other top-level sections. Do not output cover letter, executive summary, Section A, B, or D. Start directly with # Section C.`;

export const ADDITIONAL_AND_DECLARATION_SYSTEM_PROMPT = `You are a senior bid reviewer writing the closing artefacts of a competitive technical proposal — Section D (Additional Information & Value), the Appendix Register, and the formal Declaration. These sections are the bid's final impression on the evaluator. You have drafted closing sections for 700+ winning bids.

Your operating principles for Section D, Appendix Register, and Declaration:

1. EVIDENCE-BACKED VALUE. Section D's Value to the Client sub-section is NOT marketing boilerplate. Every value proposition is anchored to a specific capability the firm has demonstrated on prior work — same evidence pattern as the rest of the proposal.

2. IN-HOUSE CAPABILITIES BEYOND MINIMUM. List capabilities the firm brings WITHOUT extra cost or scope (e.g., in-house geotechnical lab, BIM, GIS, drone survey, in-house lab testing). Each line carries an evidence anchor.

3. CERTIFICATIONS WITH NUMBERS. Professional certifications, ISO accreditations, donor compliance records, and professional body memberships are listed with their registration / certificate numbers and dates. Numberless lists are weak.

4. APPENDICES BY LETTER. The Appendix Register lists each appendix by its tender-prescribed letter (Appendix A, B, C…) with a one-line description of contents. If the tender prescribes specific letters, follow them exactly.

5. FORMAL DECLARATION. The Declaration is signed off by the General Manager / Principal with name, title, license number where applicable, and the company name. Use formal proposal language: "We, [Company], hereby declare that this Technical Proposal has been prepared specifically in response to [Tender Title]…".

6. SUBMISSION CONTROL. Close with a short Pre-Submission Control note that confirms (a) the file format expected by the tender, (b) the deadline and time zone, (c) email recipients verbatim, and (d) the exact subject line.

7. NO AI TRACES. Never write "As an AI", "Certainly!", "Please note", or [square bracket] placeholders. Where a fact is missing, write a "Bid-Team Action:" note instead of fabricating.

8. OUTPUT SHAPE. Output Section D, the Appendix Register, and the Declaration as three top-level Markdown headings (# Section D: Additional Information, # Appendix Register, # Declaration). Do not output any other sections. Do not output cover letter, executive summary, Section A/B/C, or compliance matrix. Start directly with # Section D.`;

// ─── Section spec type ───────────────────────────────────────────────────────
// One spec per parallel Claude call. The id is used for logging and for
// labelling deterministic fallbacks when a section fails.

export type ProposalSectionId =
  | "cover-and-summary"
  | "company-and-experience"
  | "technical-approach"
  | "additional-and-declaration";

export interface ProposalSectionSpec {
  id: ProposalSectionId;
  title: string;
  systemPrompt: string;
  userPrompt: string;
  // Per-section output token budget. Larger sections (Technical Approach)
  // get more budget; smaller closing sections get less. Sum across all
  // four sections is intentionally LESS than the single-call budget so
  // each call comfortably finishes inside the per-section timeout.
  maxOutputTokens: number;
}

// ─── User prompt builders ────────────────────────────────────────────────────
// Each builder produces a tightly-scoped prompt for ONE Claude call.
// Slice budgets are intentionally smaller than the single-call path —
// each section only sees the evidence it needs.

function buildCoverAndSummaryPrompt(input: AIBidWriterInput): string {
  return `Write the Cover Letter and Executive Summary for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## SUBMISSION RULES
${input.submissionNotes.slice(0, 2_500)}

## EVALUATION CRITERIA
${input.evaluationMethodology.slice(0, 2_500)}

## KEY DIFFERENTIATORS
${input.differentiators.slice(0, 1_500)}

## COMPANY EVIDENCE (use this — do NOT invent anything)
${input.companyProfile.slice(0, 3_500)}

## STRONGEST PROJECTS (pick top 1–2 by direct comparability — name them in the cover letter and the executive summary opening)
${input.projects.slice(0, 4_000)}

## STRONGEST EXPERTS (pick the 1–2 lead names — link them to the named projects)
${input.experts.slice(0, 3_500)}

## TENDER TEXT EXCERPT (use to mirror evaluator language back)
${input.tenderText.slice(0, 4_500)}

## YOUR OUTPUT
Two top-level Markdown sections:
- # Cover Letter
- # Executive Summary

Cover Letter requirements:
- Addressed to the client by name; subject line carries the exact tender title
- Opening paragraph names the strongest 1–2 comparable projects BY NAME with contract values
- Second paragraph introduces the proposed lead expert(s) with comparable previous role
- Closing paragraph confirms enclosed appendices, technical-only status (when applicable), and signature block

Executive Summary requirements (3–4 paragraphs, no bullet lists):
- Lead sentence pattern: "We have already delivered this assignment. [Company] designed/supervised/assessed [Project Name] (contract value, Client) — a [parallel description]. The same team is available for this engagement."
- Address the top evaluation criterion directly with evidence
- Brief technical-approach overview tuned to THIS tender's scope
- Confirm compliance, team availability, and commitment

Start directly with "# Cover Letter". Do NOT output any other sections, table of contents, or commentary.`;
}

function buildCompanyAndExperiencePrompt(input: AIBidWriterInput): string {
  return `Write Section A (Company Profile) and Section B (Relevant Experience) for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## EVALUATION CRITERIA (especially the experience and team criteria)
${input.evaluationMethodology.slice(0, 2_500)}

## CONSOLIDATED REQUIREMENTS (especially eligibility, team composition, project experience)
${input.requirements.slice(0, 4_000)}

## COMPANY EVIDENCE (registration, services, sectors — use only this, do NOT invent anything)
${input.companyProfile.slice(0, 4_500)}

## PROPOSED EXPERT EVIDENCE (full team — list all with their licences and comparable previous roles)
${input.experts.slice(0, 5_500)}

## RELEVANT PROJECT EVIDENCE (full portfolio — pick top 2 as featured cards, the rest as a portfolio table)
${input.projects.slice(0, 6_000)}

## YOUR OUTPUT
Two top-level Markdown sections:
- # Section A: Company Profile
  - ## A.1 Company Background — founding year, licence grade, registered address, staff headcount, total projects, key sectors, certifications
  - ## A.2 Corporate Information Table — Markdown table with: legal name | registration no. | TIN/VAT | address | GM name | email | phone
  - ## A.3 Core Service Lines — disciplines directly relevant to this tender (not a generic list)
  - ## A.4 Proposed Project Team — Markdown table with columns: # | Expert & Position | Qualifications & Licenses | Comparable Sector Experience | Role on This Assignment
  - ## A.5 Team-to-Project Experience Mapping — Markdown table with columns: Expert & Role on This Project | Role Previously Performed | Previous Comparable Project | Key Technical Contribution
- # Section B: Relevant Experience
  - ## B.1 Portfolio Overview — total projects, total relevant-sector value, geographic spread (1 short paragraph)
  - ## B.2 Featured Project 1 — full project card (Markdown table) for the most comparable project
  - ## B.3 Featured Project 2 — full project card (Markdown table) for the second most comparable project
  - ## B.4 Additional Projects — Markdown table with columns: Name | Client | Country | Value | Sector | Key Services
  - ## B.5 Client References — Markdown table with columns: Project / Client | Reference Contact & Title | Contact Details | Contract Value

Where evidence is genuinely missing, write a "Bid-Team Action: confirm X before submission." note in the cell or paragraph — do NOT fabricate.

Start directly with "# Section A: Company Profile". Do NOT output any cover letter, executive summary, technical approach, Section D, compliance matrix, declaration, or commentary.`;
}

function buildTechnicalApproachPrompt(input: AIBidWriterInput): string {
  return `Write Section C — the Technical Approach — for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## TENDER TEXT (full scope — your methodology must match this exactly)
${input.tenderText.slice(0, 8_000)}

## ANALYSIS SUMMARY
${input.analysisSummary.slice(0, 2_500)}

## EVALUATION CRITERIA (your methodology must score against these)
${input.evaluationMethodology.slice(0, 2_500)}

## CONSOLIDATED REQUIREMENTS (especially technical and methodology requirements)
${input.requirements.slice(0, 4_000)}

## PROPOSED EXPERTS (name them inline in the methodology — who does what)
${input.experts.slice(0, 4_000)}

## RELEVANT PROJECT EVIDENCE (cite specific projects when they demonstrate a methodology element)
${input.projects.slice(0, 4_000)}

## YOUR OUTPUT
One top-level Markdown section:
- # Section C: Technical Approach
  - ## C.1 Understanding of the Assignment — what the client needs, key technical challenges, what the winning proposal must demonstrate (3 paragraphs, evidence-anchored)
  - ## C.2 Technical Methodology — numbered sub-sections matching the tender's scope items in the tender's order. Sector vocabulary used in context, not as a glossary. Each sub-section ties to a deliverable, a responsible named expert, and a quality-review gate.
  - ## C.3 Work Plan and Deliverables — Markdown table with columns: Stage | Deliverable | Responsible Expert | Timeline | Quality Gate
  - ## C.4 Quality Assurance — staged design-review gates table with columns: Stage | Milestone | Review Authority and Required Action

Forbidden phrases: "extensive experience" without a project name; "committed to excellence/quality"; "team of qualified professionals"; "leading firm"; "we look forward to the opportunity"; generic methodology steps without specific deliverables; any [square bracket] placeholder.

Where evidence is genuinely missing, write a "Bid-Team Action: confirm X before submission." note instead of fabricating.

Start directly with "# Section C: Technical Approach". Do NOT output any other top-level sections.`;
}

function buildAdditionalAndDeclarationPrompt(input: AIBidWriterInput): string {
  return `Write Section D (Additional Information & Value), the Appendix Register, and the formal Declaration for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## SUBMISSION RULES
${input.submissionNotes.slice(0, 2_500)}

## KEY DIFFERENTIATORS
${input.differentiators.slice(0, 2_000)}

## COMPANY EVIDENCE (especially certifications, ISO, professional bodies)
${input.companyProfile.slice(0, 3_500)}

## COMPLIANCE / EVIDENCE / GAPS
${input.compliance.slice(0, 3_500)}

## YOUR OUTPUT
Three top-level Markdown sections:
- # Section D: Additional Information
  - ## D.1 Value to the Client — Markdown table with columns: Framework Pillar | What This Engagement Delivers (4–6 evaluator-facing benefit pillars, each anchored to evidence)
  - ## D.2 In-House Capabilities Beyond Minimum Scope — bulleted list of capabilities the firm brings without extra cost (each line evidence-anchored)
  - ## D.3 Professional Certifications and Affiliations — listed with registration / certificate numbers and dates
  - ## D.4 Declaration of Eligibility — formal statement confirming the firm meets all eligibility requirements stated in the tender
- # Appendix Register
  - List each appendix by its tender-prescribed letter (Appendix A, B, C…) with a one-line description
- # Declaration
  - Formal text starting "We, [Company], hereby declare…" with signature block (GM name, title, licence, company)

Close with a one-paragraph Pre-Submission Control note confirming file format, deadline + time zone, email recipients verbatim, and exact subject line.

Forbidden phrases: "extensive experience" without anchor; "committed to excellence"; "we look forward to the opportunity"; any [square bracket] placeholder.

Where a fact is missing, write a "Bid-Team Action:" note instead of fabricating.

Start directly with "# Section D: Additional Information". Do NOT output any other top-level sections.`;
}

// ─── Public spec builder ─────────────────────────────────────────────────────

export function buildProposalSectionSpecs(input: AIBidWriterInput): ProposalSectionSpec[] {
  return [
    {
      id: "cover-and-summary",
      title: "Cover Letter and Executive Summary",
      systemPrompt: COVER_AND_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildCoverAndSummaryPrompt(input),
      maxOutputTokens: 1800,
    },
    {
      id: "company-and-experience",
      title: "Section A (Company Profile) and Section B (Relevant Experience)",
      systemPrompt: COMPANY_AND_EXPERIENCE_SYSTEM_PROMPT,
      userPrompt: buildCompanyAndExperiencePrompt(input),
      maxOutputTokens: 2400,
    },
    {
      id: "technical-approach",
      title: "Section C: Technical Approach",
      systemPrompt: TECHNICAL_APPROACH_SYSTEM_PROMPT,
      userPrompt: buildTechnicalApproachPrompt(input),
      maxOutputTokens: 2800,
    },
    {
      id: "additional-and-declaration",
      title: "Section D, Appendix Register, and Declaration",
      systemPrompt: ADDITIONAL_AND_DECLARATION_SYSTEM_PROMPT,
      userPrompt: buildAdditionalAndDeclarationPrompt(input),
      maxOutputTokens: 1600,
    },
  ];
}

// ─── Deterministic per-section fallback markdown ─────────────────────────────
// Used when a single section's Claude call fails. Each fallback returns
// markdown shaped like the section it replaces, so the downstream
// stitch + canonical-reorder pipeline still produces a complete proposal.
// These are intentionally short — the deterministic enrichers
// (compliance-matrix-builder, evaluator-mirror-builder, win-themes-builder,
// self-score-builder, narrative-throughline-enforcer) downstream will
// fill the section out with structured tables.

export function buildSectionFallback(spec: ProposalSectionSpec, input: AIBidWriterInput): string {
  switch (spec.id) {
    case "cover-and-summary":
      return [
        "# Cover Letter",
        `Subject: Technical Proposal for ${input.tenderTitle}`,
        `To: ${input.clientName}`,
        "",
        "We submit this Technical Proposal in response to the captioned tender. Bid-Team Action: confirm strongest 1–2 comparable projects by name and contract value before submission to anchor the cover letter opening.",
        "",
        "The proposed lead experts and their comparable previous roles are detailed in Section A.4 and A.5. The full proposed team appears in Section A.4.",
        "",
        "We confirm enclosed appendices and signature block.",
        "",
        "# Executive Summary",
        `${input.clientName} requires a technically robust delivery of the assignment described in this tender. Our proposal aligns directly to the stated evaluation criteria, with evidence drawn from comparable previous engagements detailed in Section B.`,
        "",
        "Bid-Team Action: confirm the lead-sentence project anchor (project name + contract value + same-team continuity) before submission. The middle paragraph must address the top evaluation criterion directly with evidence; this is currently a placeholder pending Bid-Team confirmation.",
        "",
        "We confirm compliance with all stated requirements and team availability for the engagement window.",
      ].join("\n\n");

    case "company-and-experience":
      return [
        "# Section A: Company Profile",
        "## A.1 Company Background",
        "Bid-Team Action: confirm founding year, licence grade, registered address, GM name, staff headcount, total projects, key sectors, and certifications before submission.",
        "## A.2 Corporate Information Table",
        "| Field | Detail |",
        "|---|---|",
        "| Legal name | Bid-Team Action: confirm |",
        "| Registration number | Bid-Team Action: confirm |",
        "| TIN / VAT | Bid-Team Action: confirm |",
        "| Registered address | Bid-Team Action: confirm |",
        "## A.3 Core Service Lines",
        "Refer to the COMPANY EVIDENCE section in the underlying knowledge base for service lines directly relevant to this tender.",
        "## A.4 Proposed Project Team",
        "The proposed team is built from the firm's reviewed expert library. See Section B for project-side evidence.",
        "## A.5 Team-to-Project Experience Mapping",
        "Each proposed expert is mapped to a previous comparable project — see deterministic Team-to-Project Mapping table built downstream.",
        "",
        "# Section B: Relevant Experience",
        "## B.1 Portfolio Overview",
        "The firm's portfolio relevant to this assignment is summarised in the deterministic Portfolio at a Glance and Project Portfolio sections built downstream from the reviewed evidence library.",
        "## B.2 Featured Project 1",
        "Bid-Team Action: confirm the strongest comparable project as the featured card before submission.",
        "## B.3 Featured Project 2",
        "Bid-Team Action: confirm the second strongest comparable project as the featured card before submission.",
        "## B.4 Additional Projects",
        "See deterministic project portfolio table built downstream.",
        "## B.5 Client References",
        "See deterministic Client References table built downstream.",
      ].join("\n\n");

    case "technical-approach":
      return [
        "# Section C: Technical Approach",
        "## C.1 Understanding of the Assignment",
        `${input.clientName} requires the assignment described in this tender. Bid-Team Action: confirm the three key technical challenges and the single most-decisive evaluation driver before submission.`,
        "## C.2 Technical Methodology",
        "The methodology will be structured to match each tender scope item in the tender's order. Each sub-section ties to a named deliverable, a responsible named expert from Section A.4, and a quality-review gate. Bid-Team Action: confirm sector-specific methodology depth.",
        "## C.3 Work Plan and Deliverables",
        "| Stage | Deliverable | Responsible Expert | Timeline | Quality Gate |",
        "|---|---|---|---|---|",
        "| Inception | Inception Report | Bid-Team Action | Bid-Team Action | Senior Engineer review |",
        "| Concept | Concept Design Package | Bid-Team Action | Bid-Team Action | QA gate |",
        "| Detailed | Detailed Design Package | Bid-Team Action | Bid-Team Action | Pre-issue gate |",
        "## C.4 Quality Assurance",
        "Staged design-review gates are applied at 30 / 60 / 100% milestones. See deterministic Three-Stage Quality Review table built downstream.",
      ].join("\n\n");

    case "additional-and-declaration":
      return [
        "# Section D: Additional Information",
        "## D.1 Value to the Client",
        "See deterministic Value Framework table built downstream.",
        "## D.2 In-House Capabilities Beyond Minimum Scope",
        "Bid-Team Action: confirm in-house capabilities (geotechnical lab, BIM, GIS, drone survey, in-house lab testing, etc.) before submission.",
        "## D.3 Professional Certifications and Affiliations",
        "Bid-Team Action: confirm registration / certificate numbers and dates before submission.",
        "## D.4 Declaration of Eligibility",
        "The firm meets all eligibility requirements stated in the tender.",
        "",
        "# Appendix Register",
        "- Appendix A: Company Registration Documents and Licences",
        "- Appendix B: Audited Financial Statements",
        "- Appendix C: Curricula Vitae of Proposed Experts",
        "- Appendix D: Project References and Client Letters",
        "- Appendix E: Project Photos, Drawings and Completion Evidence",
        "",
        "# Declaration",
        "We hereby declare that this Technical Proposal has been prepared specifically in response to the captioned tender. All information provided is accurate and supported by documentary evidence available on request.",
        "",
        "Bid-Team Action: confirm signature block (GM name, title, licence, company) before submission.",
      ].join("\n\n");
  }
}
