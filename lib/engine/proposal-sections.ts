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

7. CLIENT NAME FIDELITY (CRITICAL). The CLIENT field provided in the user prompt is the ONLY acceptable client name. Do NOT invent, substitute, or augment it based on other content you see in the EVIDENCE / COMPANY VAULT / PROJECT EVIDENCE sections. Even when the company's prior projects mention other clients (e.g., World Bank, Pharo Foundation, government ministries), those are the FIRM's previous clients — not the client of THIS tender. The cover letter "To:" line, the subject line, the executive summary's first paragraph, and every reference to "the Client" must use ONLY the CLIENT field's value. If the CLIENT field reads "The Client" or "[CLIENT TO BE CONFIRMED]", echo that exactly — do not improve it. Re-labelling the tender after a prior project's client is the single most common bid-disqualifying error and is forbidden.

8. OUTPUT SHAPE. Output the Cover Letter and Executive Summary as two top-level Markdown headings (# Cover Letter, # Executive Summary). Do not output any other sections. Do not output a Table of Contents. Do not output any commentary before, between, or after the two sections.`;

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

export const TECHNICAL_APPROACH_SYSTEM_PROMPT = `You are a senior sector technical lead writing Section C — the Technical Approach — of a competitive technical proposal. Section C is where the proposal demonstrates HOW the firm will deliver. You have led the Technical Approach drafting for 800+ winning bids across every major sector — healthcare, water/sanitation, road/bridge, building, urban planning, environmental and social safeguards, ICT/digital systems, education, agriculture, energy/power, mining, telecoms, transportation, port/logistics, oil & gas, financial services, and public-sector institutional reform. You handle ANY sector — your job is to read the tender text, identify the sector and its conventions, and write methodology in that sector's vocabulary.

Your operating principles for Section C:

1. SECTOR-NEUTRAL THEN SECTOR-SPECIFIC. Read the TENDER TEXT first. Identify the dominant sector(s) and their professional conventions. Then write methodology in those conventions:
   - Healthcare → clinical zone segregation, IPC, medical gas, radiation shielding, biomedical engineering integration.
   - Water/sanitation → hydraulic modelling (WaterCAD/EPANET), source investigation, pipe sizing, pump station design, water quality.
   - Road/bridge → alignment survey, geotechnical (CBR, Proctor), pavement design, drainage, road safety audit.
   - Building/architecture → functional brief, MEP coordination, fire safety, accessibility, building permit documentation.
   - Urban/master planning → GIS-based land use mapping, demographic analysis, infrastructure demand assessment, phased implementation roadmap.
   - Environmental/social → ESIA baseline, impact identification matrices, mitigation hierarchy, ESMP, stakeholder engagement, donor safeguard alignment.
   - ICT/digital → requirements analysis, architecture (app/database/network), data security, integration plan, UAT, training, go-live cutover.
   - Education facilities → space schedule, climate-responsive design, pupil-to-toilet ratio compliance, fire detection.
   - Energy/power → load forecast, generation/transmission/distribution design, grid integration, environmental compliance.
   - Agriculture → agronomic baseline, yield modelling, irrigation/drainage, post-harvest handling, value-chain analysis.
   - Other sectors not listed above → use the sector's professional conventions as best you can identify them from the tender text. Do NOT default to generic engineering language.

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
  // PR #259 — inject structured company-vault contact block so
  // Claude's cover letter can carry the firm's real registration,
  // tax, license, and signatory details verbatim. Mirror Claude's
  // benchmark pattern: TIN, VAT, license category, GM with PPE
  // license number all surface on the cover page.
  const v = input.companyVault ?? {};
  const vaultContactLines: string[] = [];
  if (v.name) vaultContactLines.push(`Company: ${v.name}`);
  if (v.legalName && v.legalName !== v.name) vaultContactLines.push(`Legal: ${v.legalName}`);
  if (v.address) vaultContactLines.push(`Address: ${v.address}`);
  if (v.phone) vaultContactLines.push(`Phone: ${v.phone}`);
  if (v.email) vaultContactLines.push(`Email: ${v.email}`);
  if (v.website) vaultContactLines.push(`Website: ${v.website}`);
  if (v.tin) vaultContactLines.push(`TIN: ${v.tin}`);
  if (v.vat) vaultContactLines.push(`VAT: ${v.vat}`);
  if (v.licenseGrade) vaultContactLines.push(`License grade: ${v.licenseGrade}`);
  if (v.gmName) vaultContactLines.push(`General Manager: ${v.gmName}${v.gmTitle ? `, ${v.gmTitle}` : ""}${v.gmLicense ? ` (License ${v.gmLicense})` : ""}`);
  const vaultContactBlock = vaultContactLines.length > 0
    ? `\n## STRUCTURED COMPANY CONTACT (use these EXACT values in the cover letter address block AND the executive summary firm-introduction line — do not invent or alter)\n${vaultContactLines.join("\n")}\n`
    : "";

  // PR W — list of firm-history clients to AVOID substituting as the
  // client of THIS tender. Belt-and-braces with the post-pass enforcer
  // (lib/engine/client-name-enforcer.ts) — prompt-side prevention is
  // free; the post-pass is the safety net.
  const avoidClients = (input.doNotUseAsClient ?? []).filter((c) => c && c.trim().length >= 3);
  const avoidBlock = avoidClients.length > 0
    ? `\n## CLIENT NAMES TO NEVER USE AS THE CLIENT OF THIS TENDER\n\nThe following names appear in the FIRM's project history (Section B project cards reference them, which is correct). They are the firm's PREVIOUS clients — they are NOT the client of THIS tender. NEVER use any of these as the client name in the cover letter "To:" line, the subject line, or the executive summary's first paragraph. Use ONLY the CLIENT field above.\n\n${avoidClients.slice(0, 12).map((c) => `- ${c}`).join("\n")}\n`
    : "";

  return `Write the Cover Letter and Executive Summary for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}
${vaultContactBlock}${avoidBlock}
## SUBMISSION RULES
${input.submissionNotes.slice(0, 2_500)}

## EVALUATION CRITERIA
${input.evaluationMethodology.slice(0, 4_500)}

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

LENGTH REQUIREMENTS (BENCHMARK MATCH — non-negotiable):
- Cover Letter: minimum 5 paragraphs of 70–120 words each (~400–600 words total).
  Target proposal-quality density. Do NOT write 4 short paragraphs.
- Executive Summary: minimum 5 paragraphs of 70–120 words each (~400–600 words total).
  Each paragraph carries at least one project name + contract value OR
  named expert + licence OR specific tender clause echoed verbatim.

Cover Letter structure (each paragraph ~70–120 words):
- Para 1 — Opening: Name the firm; address the client (use ONLY the
  CLIENT field); state the exact tender title; reference the strongest
  1–2 comparable projects BY NAME with contract value AND name the lead
  expert from each. End with "the same team is proposed for this
  engagement."
- Para 2 — Tender understanding: Echo 2–3 verbatim phrases from the
  tender's evaluation criteria or scope. Demonstrate the bidder has
  read the tender end-to-end.
- Para 3 — Capacity statement: List the firm's relevant in-house
  capabilities + total project portfolio + key resources (BIM, GIS,
  drone, in-house lab, etc.) — anchor each to evidence.
- Para 4 — Team and methodology: Introduce the proposed lead expert(s)
  by name + licence + comparable previous role. State the methodology
  framework in one sentence.
- Para 5 — Compliance and signature: Confirm enclosed appendices, file
  format compliance, deadline awareness, technical-only status (when
  applicable), and a formal signature block (GM name + title +
  licence + company).

Executive Summary structure (each paragraph ~70–120 words):
- Para 1 — Evidence anchor: "We have already delivered this assignment.
  [Company] designed/supervised/assessed [Project Name] (contract value,
  Client) — a [parallel description]. The same team is available for
  this engagement."
- Para 2 — Top evaluation criterion: Address the highest-weighted
  evaluation criterion directly with concrete evidence (project name,
  expert role on it, deliverable that scored).
- Para 3 — Technical approach overview: Three to four sentences on
  methodology phases tuned to THIS tender's scope items in the tender's
  order.
- Para 4 — Risk and quality: One paragraph confirming the firm's QA
  philosophy (peer review at 30%/60%/100% gates, independent reviewer)
  + the 2–3 highest-impact risks with named mitigations.
- Para 5 — Compliance and continuity: Confirm full compliance with
  every stated requirement, team availability for the engagement
  window, post-handover advisory window, and adherence to commercial
  terms (validity, payment, taxes).

Start directly with "# Cover Letter". Do NOT output any other sections,
table of contents, or commentary. Do NOT use bullet lists in either
section — use prose paragraphs only.`;
}

function buildCompanyAndExperiencePrompt(input: AIBidWriterInput): string {
  // PR #257 — structured company-vault fields injected directly into
  // the prompt so Claude can quote real founding year, headcount,
  // license grade, GM name + license, TIN, VAT, etc. instead of
  // "Bid-Team Action: confirm" placeholders. The free-form
  // companyProfile string remains as supplementary context for
  // narrative paragraphs.
  const v = input.companyVault ?? {};
  const vaultLines: string[] = [];
  if (v.name) vaultLines.push(`Name: ${v.name}`);
  if (v.legalName && v.legalName !== v.name) vaultLines.push(`Legal name: ${v.legalName}`);
  if (v.foundingYear) vaultLines.push(`Founding year: ${v.foundingYear}`);
  if (v.headcount) vaultLines.push(`Headcount: ${v.headcount}`);
  if (v.licenseGrade) vaultLines.push(`Licence grade: ${v.licenseGrade}`);
  if (v.registrationNumber) vaultLines.push(`Registration number: ${v.registrationNumber}`);
  if (v.tin) vaultLines.push(`TIN: ${v.tin}`);
  if (v.vat) vaultLines.push(`VAT: ${v.vat}`);
  if (v.address) vaultLines.push(`Address: ${v.address}`);
  if (v.country) vaultLines.push(`Country: ${v.country}`);
  if (v.phone) vaultLines.push(`Phone: ${v.phone}`);
  if (v.email) vaultLines.push(`Email: ${v.email}`);
  if (v.website) vaultLines.push(`Website: ${v.website}`);
  if (v.gmName) vaultLines.push(`General Manager: ${v.gmName}${v.gmTitle ? `, ${v.gmTitle}` : ""}${v.gmLicense ? ` (License ${v.gmLicense})` : ""}`);
  if (v.serviceLines && v.serviceLines.length > 0) vaultLines.push(`Service lines: ${v.serviceLines.join(", ")}`);
  if (v.sectors && v.sectors.length > 0) vaultLines.push(`Sectors: ${v.sectors.join(", ")}`);
  const vaultBlock = vaultLines.length > 0
    ? `\n## STRUCTURED COMPANY VAULT FIELDS (use these EXACT values in Section A.1 prose and the A.2 Corporate Information Table — do not invent or alter)\n${vaultLines.join("\n")}\n`
    : "";

  return `Write Section A (Company Profile) and Section B (Relevant Experience) for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## EVALUATION CRITERIA (especially the experience and team criteria)
${input.evaluationMethodology.slice(0, 4_500)}
${vaultBlock}

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
  - ## A.1 Company Background — 2 substantive paragraphs (~80–120 words each) covering founding year, licence grade, registered address, staff headcount, total projects, key sectors, certifications. Quote vault values verbatim. Open with the firm's most differentiating trait (PhD-qualified specialists, in-house geotech lab, donor-funded experience) — not generic "leading firm" language.
  - ## A.2 Corporate Information Table — Markdown table with: legal name | registration no. | TIN/VAT | address | GM name | email | phone
  - ## A.3 Core Service Lines — bulleted list of 5–8 service lines directly relevant to THIS tender's scope (not a generic catalogue). Each bullet 8–18 words.
  - ## A.4 Proposed Project Team — Markdown table with columns: # | Expert & Position | Qualifications & Licenses | Comparable Sector Experience | Role on This Assignment
  - ## A.5 Team-to-Project Experience Mapping — Markdown table with columns: Expert & Role on This Project | Role Previously Performed | Previous Comparable Project | Key Technical Contribution

- # Section B: Relevant Experience
  - ## B.1 Portfolio Overview — 1–2 paragraphs (~80–120 words) covering total projects, total relevant-sector value, geographic spread, donor exposure, recent flagship deliveries
  - ## B.2 Featured Project 1 — full project card (Markdown table) for the most comparable project, plus a 2–3 sentence "Why this anchors THIS tender" narrative under the table
  - ## B.3 Featured Project 2 — full project card (Markdown table) for the second most comparable project, plus a 2–3 sentence "Why this anchors THIS tender" narrative
  - ## B.4 Additional Projects — Markdown table with columns: Name | Client | Country | Value | Sector | Key Services
  - ## B.5 Client References — Markdown table with columns: Project / Client | Reference Contact & Title | Contact Details | Contract Value

LENGTH REQUIREMENTS:
- Section A total: minimum 600 words across A.1 + A.3 prose plus the
  three tables. Do NOT write thin one-paragraph backgrounds.
- Section B total: minimum 500 words across B.1 + the two featured-
  project narratives plus the tables.

CLIENT NAME FIDELITY: Use ONLY the CLIENT field above as the client.
Firm-history project clients are referenced in Section B project cards
but NEVER substituted for the current tender's client.
${(input.doNotUseAsClient ?? []).filter(Boolean).length > 0
  ? `\nPREVIOUS CLIENTS (appear in Section B project cards only — NEVER as the client of THIS tender):\n${(input.doNotUseAsClient ?? []).slice(0, 12).map((c) => `- ${c}`).join("\n")}\n`
  : ""}
Where evidence is genuinely missing, write a "Bid-Team Action: confirm X before submission." note in the cell or paragraph — do NOT fabricate.

Start directly with "# Section A: Company Profile". Do NOT output any cover letter, executive summary, technical approach, Section D, compliance matrix, declaration, or commentary.`;
}

function buildTechnicalApproachPrompt(input: AIBidWriterInput): string {
  // Criterion evidence map — inject when available so Claude knows
  // exactly which evidence to cite per evaluation criterion, and at
  // what prose depth (proportional to criterion weight).
  const criterionBlock = input.criterionEvidenceMap && input.criterionEvidenceMap.trim().length > 0
    ? `\n## CRITERION-TO-EVIDENCE ALLOCATION (NON-NEGOTIABLE — follow this exactly)\n${input.criterionEvidenceMap}\n\nFor EACH criterion above, write a dedicated sub-section in C.2 that:\n1. Cites the listed PROJECT(s) by name with contract value as proof of delivery\n2. Names the listed EXPERT(s) with their specific role on that project\n3. Allocates word count PROPORTIONAL to the criterion weight — the highest-weight criterion gets the longest, most evidence-dense sub-section\n`
    : "";

  return `Write Section C — the Technical Approach — for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## TENDER TEXT (full scope — your methodology must match this exactly)
${input.tenderText.slice(0, 8_000)}

## ANALYSIS SUMMARY
${input.analysisSummary.slice(0, 2_500)}

## EVALUATION CRITERIA (your methodology must score against these — allocate depth proportionally to each criterion's weight)
${input.evaluationMethodology.slice(0, 4_500)}
${criterionBlock}
## CONSOLIDATED REQUIREMENTS (especially technical and methodology requirements)
${input.requirements.slice(0, 4_000)}

## PROPOSED EXPERTS (name them inline in the methodology — who does what)
${input.experts.slice(0, 4_000)}

## RELEVANT PROJECT EVIDENCE (cite specific projects when they demonstrate a methodology element)
${input.projects.slice(0, 4_000)}

## DETERMINISTIC POST-INJECTION (DO NOT DUPLICATE THESE STRUCTURES)
After your output is generated, the engine will deterministically inject the
following structured content into Section C — these will be appended
automatically. DO NOT write your own version of any structure in this list,
because that wastes output tokens and creates duplicate or contradictory
content:

C.0 Tender Specifics Recognised by This Proposal (verbatim RFP ID,
deadline, validity, deliverable codes, location, file formats, brand,
distinctive quantities — auto-populated from tender text)
- Project Phasing and Deliverables (5-phase table)
- RACI Matrix (8 activities × team roles)
- Risk Register (5–7 sector-specific risks)
- Quality Assurance Plan + Inspection & Test Plan (ITP)
- Communication and Reporting Protocol
- Deliverable-to-Project Crosswalk (D-codes mapped to projects)
- Phase-by-Phase Methodology Narrative (6 phase paragraphs, named expert
  per phase, sector-specific activities, artefacts per phase)
- Tender-Specific Innovation Hooks (named/branded innovations when tender
  carries brand or website)

Use your output tokens for what an AI does best: substantive PROSE methodology,
sector vocabulary in context, named-expert anchoring, project evidence
anchoring, and tender-clause echoing. Leave the deterministic tables to the
engine.

## YOUR OUTPUT
One top-level Markdown section, FOCUSED on prose methodology:
- # Section C: Technical Approach
  - ## C.1 Understanding of the Assignment — 4 substantive paragraphs
    (~100–140 words each, ~500 words total). Para 1: what the client
    actually needs (echo verbatim tender quotes). Para 2: the key
    technical challenges THIS tender will face (cite specific quantities,
    standards, deliverable codes from tender). Para 3: what a winning
    proposal must demonstrate — and what differentiates this firm.
    Para 4: how the firm's prior comparable projects already prove
    capacity (cite 2 project names + values).
  - ## C.2 Technical Methodology — minimum 6 numbered sub-sections matching
    the tender's scope items in the tender's order. Each sub-section is
    100–180 words. Sector vocabulary used in context, not as a glossary.
    Each sub-section ties to a deliverable, a responsible named expert
    (use real names from the EXPERT EVIDENCE), and a quality-review gate.
    Cite specific projects from the evidence library where they demonstrate
    a methodology element. NO generic "Stage 1: Planning, Stage 2:
    Execution" — every step is sector-specific and tender-specific.
  - ## C.3 Work Plan and Deliverables — 3 paragraphs of NARRATIVE
    (~80–120 words each) describing how phases interlock, where the
    critical path runs, what artefacts are produced per phase, and
    how client decisions gate phase transitions. (The engine appends
    a Phasing table separately — do not duplicate the table.)
  - ## C.4 Quality Assurance — 3 paragraphs of NARRATIVE (~80–120 words
    each) on the firm's QA philosophy: how 30%/60%/100% gates work,
    peer-review discipline, independent reviewer role, how client
    comments are tracked, deliverable acceptance thresholds. (The
    engine appends a QA/ITP table separately — do not duplicate.)

LENGTH REQUIREMENT: Section C total minimum 1,800 words across C.1
+ C.2 + C.3 + C.4. The Section C narrative is the heart of the
proposal; thin Section C = lost bid.

Forbidden phrases: "extensive experience" without a project name;
"committed to excellence/quality"; "team of qualified professionals";
"leading firm"; "we look forward to the opportunity"; generic methodology
steps without specific deliverables; any [square bracket] placeholder.

Where evidence is genuinely missing, write a "Bid-Team Action: confirm X
before submission." note instead of fabricating.

Start directly with "# Section C: Technical Approach". Do NOT output any
other top-level sections.`;
}

function buildAdditionalAndDeclarationPrompt(input: AIBidWriterInput): string {
  const avoidD = (input.doNotUseAsClient ?? []).filter((c) => c && c.trim().length >= 3);
  return `Write Section D (Additional Information & Value), the Appendix Register, and the formal Declaration for this technical proposal.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}
${avoidD.length > 0 ? `\nPREVIOUS CLIENTS — never use these as the client of THIS tender (they appear in Section B project cards as historical clients only):\n${avoidD.slice(0, 12).map((c) => `- ${c}`).join("\n")}\n` : ""}
## SUBMISSION RULES
${input.submissionNotes.slice(0, 2_500)}

## KEY DIFFERENTIATORS
${input.differentiators.slice(0, 2_000)}

## COMPANY EVIDENCE (especially certifications, ISO, professional bodies)
${input.companyProfile.slice(0, 3_500)}

## COMPLIANCE / EVIDENCE / GAPS
${input.compliance.slice(0, 3_500)}

## DETERMINISTIC POST-INJECTION (DO NOT DUPLICATE THESE STRUCTURES)
After your output is generated, the engine will deterministically inject
the following Section A / D / E / Closers structural content into the
proposal automatically. DO NOT write your own versions:

Section A additions (auto-injected at end of Section A):
- PER 01 — Personnel Loading Table (Role | Expert | Licence | Days)
- PER 02 — Per-Expert Profile Cards (9 vertical 7-row cards)
- Project Management Organogram (PM + 3 streams with named experts)
- Mobilization and Resourcing Plan (week-by-week ramp-up)

Section D additions (auto-injected end of Section D):
- Sustainability and ESG Plan
- Health and Safety Plan
- Innovation and Value Engineering Proposals
- Local Content and Capacity Building
- Win Themes and Discriminators

Closers (auto-injected before Section E):
- Tender-Specific Obstacles and Mitigation
- Commercial Understanding and Compliance
- Anti-Bribery, Ethics, and Conflict of Interest Declaration (8 clauses
  with vault GM signature)

End of document:
- Submission Readiness Checklist (bid-manager tear-out)

Use your output tokens for substantive narrative on D.1 Value to the
Client and D.2 In-House Capabilities only. Do NOT write a separate
Declaration block — the engine emits the 8-clause structured one.

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
//
// `deep` flag — when true, each section's max_output_tokens scales up
// roughly 2× so the proposal uses the full Anthropic Tier 2+ output
// budget (16K tokens/min). This is the "FULL POWER" mode the user
// asked for: each call produces materially longer prose, the four
// calls together emit ~16K tokens of Claude content per proposal
// instead of ~8K.
//
// Deep mode also enables the Section C drill-down (see
// buildSectionCDrillDownSpec below) — a chained second call that
// re-writes Section C's Methodology sub-sections with much more depth.

// PR WW — tier-aware token budgets. The pre-PR-WW defaults were tuned
// for Anthropic Tier 2 (16K output tokens/minute) and assumed deep mode
// for Tier 2+. With users on Tier 1 (~10K output/min) hitting 429
// rate-limit errors mid-generation, we need a tighter set of safe
// defaults that fit inside the lowest practical tier.
//
// Tiers (Anthropic public, May 2026):
//   • Tier 1 ($5 deposit, default new accounts): ~10K output/min
//   • Tier 2 ($40 deposit): ~16K output/min
//   • Tier 3 ($200 deposit): ~80K output/min
//   • Tier 4 ($400 deposit): ~200K output/min
//
// Selection: ANTHROPIC_TIER env var (numeric: "1" | "2" | "3" | "4").
// Default 2 — works for both Tier 1 (slightly tight, but the per-section
// timeouts catch any 429-related slowness) and Tier 2 (comfortable).
//
// Per-section budgets sum to the 4 parallel calls' total output. On
// Tier 1/2 we keep the sum at ~9.5K to leave room for prompt/system
// overhead and any retry. Tier 3+ unlocks the rich-prose budgets.
type Tier = 1 | 2 | 3 | 4;

function detectTier(): Tier {
  const raw = (process.env.ANTHROPIC_TIER || "").trim();
  if (raw === "1") return 1;
  if (raw === "3") return 3;
  if (raw === "4") return 4;
  return 2; // default — safe across Tier 1/2
}

interface TierBudget {
  cover: number;
  ab: number;
  c: number;
  d: number;
  drillDown: number;
}

function tierBudget(tier: Tier, deep: boolean): TierBudget {
  if (tier === 1) {
    // Hard squeeze for 10K/min. Total ~7,200 leaves 2,800 headroom.
    return { cover: 1700, ab: 2000, c: 2200, d: 1300, drillDown: 0 };
  }
  if (tier === 2) {
    // Total ~10,400 — fits in 16K/min after prompt overhead.
    // Section C gets 3,500 (up from 2,800) because Technical Approach
    // is the highest-scored section in most tenders. The criterion-
    // evidence map injected into the prompt makes each extra token
    // highly productive — Claude uses it to write evidence-anchored
    // depth per criterion rather than generic methodology.
    // drillDown=3000 is activated by default for Tier 2+ (auto deep mode).
    // Serial after the four parallel calls — net wall-time ~12-18s.
    return { cover: 2400, ab: 2500, c: 3500, d: 2000, drillDown: deep ? 3000 : 0 };
  }
  // Tier 3+: rich prose; deep mode activates full drill-down
  if (deep) {
    return { cover: 4500, ab: 5500, c: 6500, d: 3500, drillDown: 6000 };
  }
  return { cover: 3000, ab: 3200, c: 3600, d: 2200, drillDown: 0 };
}

// Chunked budgets — used when each section group is its own Vercel invocation
// (browser makes 3 sequential calls). Each call gets a fresh 60s window, so
// we can allocate 2× the tokens vs the parallel-within-one-function budgets.
// Caps are chosen to keep each individual Claude call under ~45s (leaving a
// 15s buffer against the 60s Hobby function limit).
//   Chunk 1: cover + AB in parallel  → max(cover, ab) ≈ 27s
//   Chunk 2: technical approach only → c ≈ 38s
//   Chunk 3: additional+declaration  → d ≈ 20s
function chunkedTierBudget(tier: Tier): TierBudget {
  if (tier === 1) return { cover: 2800, ab: 3000, c: 4000, d: 2500, drillDown: 0 };
  if (tier === 2) return { cover: 4500, ab: 5500, c: 7500, d: 4000, drillDown: 0 };
  return { cover: 6000, ab: 7500, c: 10000, d: 5000, drillDown: 0 };
}

export function buildProposalSectionSpecs(input: AIBidWriterInput, opts?: { deep?: boolean; chunked?: boolean }): ProposalSectionSpec[] {
  const deep = opts?.deep === true;
  const chunked = opts?.chunked === true;
  const tier = detectTier();
  const budget = chunked ? chunkedTierBudget(tier) : tierBudget(tier, deep);
  return [
    {
      id: "cover-and-summary",
      title: "Cover Letter and Executive Summary",
      systemPrompt: COVER_AND_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildCoverAndSummaryPrompt(input),
      maxOutputTokens: budget.cover,
    },
    {
      id: "company-and-experience",
      title: "Section A (Company Profile) and Section B (Relevant Experience)",
      systemPrompt: COMPANY_AND_EXPERIENCE_SYSTEM_PROMPT,
      userPrompt: buildCompanyAndExperiencePrompt(input),
      maxOutputTokens: budget.ab,
    },
    {
      id: "technical-approach",
      title: "Section C: Technical Approach",
      systemPrompt: TECHNICAL_APPROACH_SYSTEM_PROMPT,
      userPrompt: buildTechnicalApproachPrompt(input),
      maxOutputTokens: budget.c,
    },
    {
      id: "additional-and-declaration",
      title: "Section D, Appendix Register, and Declaration",
      systemPrompt: ADDITIONAL_AND_DECLARATION_SYSTEM_PROMPT,
      userPrompt: buildAdditionalAndDeclarationPrompt(input),
      maxOutputTokens: budget.d,
    },
  ];
}

// ─── Section C drill-down (deep-mode chained second call) ────────────────────
//
// When PROPOSAL_DEEP_MODE=true, the orchestrator runs ONE more chained
// Claude call that takes the just-generated Section C and asks the AI
// to deepen the Methodology sub-section specifically — adding 2-3
// paragraphs per scope item, naming experts inline, citing previous
// projects when the methodology element was demonstrated there.
//
// The drilled-down output replaces the original Section C in the final
// stitched proposal. Net: Section C becomes much more substantive
// without making any single Claude call long enough to time out.

export const TECHNICAL_APPROACH_DRILLDOWN_SYSTEM_PROMPT = `You are a senior sector technical lead deepening Section C — the Technical Approach — of a competitive technical proposal. The first-pass author has produced a complete Section C with the right structure (C.1 Understanding, C.2 Methodology, C.3 Work Plan, C.4 QA). Your job is to REWRITE the same Section C with substantially more depth — 2-3 paragraphs per methodology sub-section, named experts inline, evidence anchors from prior projects.

Operating principles:

1. PRESERVE STRUCTURE. Keep the existing sub-section headings (C.1, C.2.x, C.3, C.4). Do NOT add new top-level headings. Do NOT change the section number.

2. PRESERVE FACTS. The first-pass author drew project names, expert names, and license numbers from the evidence library. Those facts are correct. Do NOT change them, do NOT delete them, do NOT substitute different ones.

3. DEEPEN METHODOLOGY (C.2). Each scope item that was written as a single paragraph now becomes 2-3 paragraphs:
   - paragraph 1: WHAT the methodology covers and the standards / conventions it follows
   - paragraph 2: HOW the firm has executed this methodology element on a previous comparable project (named project + the specific methodology technique used)
   - paragraph 3 (when applicable): WHO on the proposed team will lead this element and what their comparable previous role was

4. DEEPEN WORK PLAN (C.3). The Work Plan table stays a table, but each row now carries: stage, deliverable, responsible named expert, timeline, quality gate, AND a one-line note linking the deliverable to a tender requirement number / scope item.

5. DEEPEN QA (C.4). The Quality Review gates table now carries: stage, milestone, review authority, required action, AND a one-line note on what evidence the gate produces (sign-off memo, regulatory submission, design review record).

6. NO AI TRACES. Never write "As an AI", "Certainly!", "Please note", or [square bracket] placeholders. Where a fact is missing, write a "Bid-Team Action: confirm X before submission." note.

7. OUTPUT SHAPE. Output Section C only — as a single top-level Markdown heading (# Section C: Technical Approach) with sub-sections (## C.1, ## C.2 with numbered sub-headings, ## C.3, ## C.4). Do not output cover letter, executive summary, Section A/B/D, or any commentary. Start directly with # Section C.`;

function buildTechnicalApproachDrillDownPrompt(input: AIBidWriterInput, firstPassSectionC: string): string {
  return `Deepen Section C — Technical Approach — for this technical proposal. The first-pass version is below; rewrite it with substantially more methodology depth and evidence integration.

## TENDER
TITLE: ${input.tenderTitle}
CLIENT: ${input.clientName}

## TENDER TEXT (use to align methodology vocabulary to THIS sector)
${input.tenderText.slice(0, 8_000)}

## EVALUATION CRITERIA (your methodology must score against these)
${input.evaluationMethodology.slice(0, 4_500)}

## CONSOLIDATED REQUIREMENTS (especially methodology and technical requirements)
${input.requirements.slice(0, 4_500)}

## PROPOSED EXPERTS (name them inline in C.2 — each scope item gets a responsible named expert)
${input.experts.slice(0, 5_000)}

## RELEVANT PROJECT EVIDENCE (cite specific projects when they demonstrated a methodology element)
${input.projects.slice(0, 5_000)}

## FIRST-PASS SECTION C (preserve the structure; deepen each sub-section)
${firstPassSectionC}
${input.criterionEvidenceMap && input.criterionEvidenceMap.trim().length > 0
  ? `\n## CRITERION-TO-EVIDENCE ALLOCATION (follow this exactly when deepening each sub-section)\n${input.criterionEvidenceMap}\n`
  : ""}
## YOUR OUTPUT
Rewrite Section C with materially more methodology depth:
- C.1 Understanding: 3-4 substantive paragraphs anchored to the tender's stated context
- C.2 Methodology: each scope item → 2-3 paragraphs (what / how with evidence anchor / who from the proposed team)
- C.3 Work Plan and Deliverables: full Markdown table with one row per stage (Stage | Deliverable | Responsible Expert | Timeline | Quality Gate | Tender Requirement Reference)
- C.4 Quality Assurance: full Markdown table (Stage | Milestone | Review Authority | Required Action | Evidence Output)

Start directly with "# Section C: Technical Approach". Do NOT output any other sections.`;
}

export function buildSectionCDrillDownSpec(input: AIBidWriterInput, firstPassSectionC: string): ProposalSectionSpec {
  return {
    id: "technical-approach", // same id — the drill-down REPLACES the first-pass Section C
    title: "Section C: Technical Approach (deep drill-down)",
    systemPrompt: TECHNICAL_APPROACH_DRILLDOWN_SYSTEM_PROMPT,
    userPrompt: buildTechnicalApproachDrillDownPrompt(input, firstPassSectionC),
    maxOutputTokens: 6000,
  };
}

// Helper: extract just the Section C portion from a stitched proposal
// markdown so the drill-down call has the right input to deepen.
export function extractSectionCFromMarkdown(markdown: string): string | null {
  const sectionCMatch = markdown.match(/^# Section C[\s\S]*?(?=^# (?!Section C)|$(?![\r\n]))/m);
  return sectionCMatch ? sectionCMatch[0].trim() : null;
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
      return buildCoverAndSummaryFallback(input);

    case "company-and-experience":
      return buildCompanyAndExperienceFallback(input);

    case "technical-approach": {
      const tenderRef = input.tenderTitle ? `**${input.tenderTitle}**` : "this assignment";
      const client = input.clientName || "the Client";
      // Parse top scored/mandatory requirements from the requirements string
      const reqLines = input.requirements
        .split("\n")
        .map((l) => l.replace(/^[-*•]\s*/, "").replace(/^(MANDATORY|SCORED|INFORMATIONAL):?\s*/i, "").trim())
        // Exclude ALL BENCHMARK_CONTEXT_LINES injected as prompt meta-directives:
        // they all start with an ALL-CAPS keyword followed by " RULE:" or " BENCHMARK"
        .filter((l) => l.length > 15 && !/\bBENCHMARK\b|\bRULE:\s/i.test(l.slice(0, 60)))
        .slice(0, 8);
      // Parse top expert names
      const expertNames = input.experts
        .split("\n")
        .map((l) => l.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/)?.[1] ?? "")
        .filter(Boolean)
        .slice(0, 4);
      const leadExpert = expertNames[0] || "the lead expert";
      const team = expertNames.length > 1 ? expertNames.join(", ") : leadExpert;
      // Build methodology sections from top requirements
      const methodBlocks = reqLines.slice(0, 6).map((req, i) => {
        const expert = expertNames[i % expertNames.length] || "the assigned expert";
        return `### C.2.${i + 1} ${req.slice(0, 80)}\n\nOur approach to this requirement begins with a thorough review of ${client}'s stated scope, constraints, and any applicable standards. ${expert} will lead this scope item, applying the firm's proven methodology and drawing on comparable project experience. The deliverable for this scope item will be prepared at schematic, detailed, and final stages with internal QA review at each gate before submission to ${client} for approval.`;
      });
      const workPlanRows = [
        ["1 — Inception", "Inception Report + Work Plan", leadExpert, "Week 1–2", "PM sign-off"],
        ["2 — Data Collection", "Site Survey Report + Data Register", team, "Week 2–4", "Senior Engineer"],
        ["3 — Analysis", "Technical Assessment Report", leadExpert, "Week 4–6", "QA peer review"],
        ["4 — Concept Design", "Concept Design Package", leadExpert, "Week 6–8", "Client presentation"],
        ["5 — Detailed Design", "Detailed Design + BOQ + Specs", team, "Week 8–14", "30%/60%/100% gates"],
        ["6 — Final Submission", "Final Document Package", leadExpert, "Week 14–16", "Director sign-off"],
      ];
      return [
        "# Section C: Technical Approach",
        "## C.1 Understanding of the Assignment",
        `${client} requires ${tenderRef}. This assignment requires the proposed team to address the scope items in sequence, applying sector-specific technical standards and delivering each output at the quality level required for client approval. The three key technical challenges identified are: (1) alignment of the detailed scope with ${client}'s stated requirements and applicable standards; (2) ensuring the proposed team's expertise directly addresses the highest-weighted evaluation criteria; and (3) maintaining schedule discipline across a multi-stage delivery. Our approach in Section C.2 addresses each scope item in turn, naming the responsible expert and the quality gate for each deliverable.\n\nThe evaluation criteria identified in this tender require the firm to demonstrate not only technical competence but also the capacity to manage scope, schedule, and quality concurrently. Our methodology is built around a staged approach with explicit client-approval milestones at each phase transition, ensuring that ${client} retains oversight throughout the assignment and that no stage proceeds until the prior deliverable has been accepted.\n\nThe firm's comparable project portfolio demonstrates delivery of assignments of similar scope, sector, and complexity. The strongest project analogues are identified in Section B; each analogous project is cited within the methodology sections below to substantiate the proposed approach with direct precedent, not generic best-practice statements.`,
        "## C.2 Technical Methodology",
        methodBlocks.length > 0 ? methodBlocks.join("\n\n") : `### C.2.1 Technical Methodology\n\nThe methodology for ${tenderRef} is structured to address each scope item in the tender's stated order. Each stage ties to a deliverable, a responsible named expert, and an internal quality-review gate. The approach applies the firm's established standards for scope review, technical analysis, and staged delivery with client approval milestones at each phase transition.`,
        "## C.3 Work Plan and Deliverables",
        `The assignment is structured across six overlapping stages with defined deliverables, responsible experts, and client approval milestones. The critical path runs through the detailed design stage; all prior stages feed into it and each later stage depends on approved outputs from the one before.\n\n| Stage | Deliverable | Responsible Expert | Timeline | Quality Gate |\n|---|---|---|---|---|\n${workPlanRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`,
        "## C.4 Quality Assurance",
        `Quality assurance for ${tenderRef} is managed through a three-gate internal review cycle: 30% gate (internal peer review by a senior engineer not on the primary design team), 60% gate (cross-discipline coordination check and client interim review), and 100% gate (director-level sign-off and final compliance verification before issue). No deliverable proceeds to the next stage without written confirmation that the prior gate has been passed.\n\nAll technical documents are version-controlled and issued with a revision history. Comments received from ${client} at each interim review are logged in a comment-response matrix and formally closed before the next stage begins. This approach ensures full traceability between ${client}'s requirements, the technical response, and the final submitted deliverables.\n\nRisk management is integrated into the QA programme: the top three technical risks for this assignment (scope ambiguity, tight schedule, and specialist availability) are tracked on a live risk register updated at each gate and shared with ${client} at every interim submission.`,
      ].join("\n\n");
    }

    case "additional-and-declaration":
      return buildAdditionalAndDeclarationFallback(input);
  }
}

// ─── Substantive deterministic content (PR #257) ─────────────────────────────
//
// These helpers replace the "Bid-Team Action: confirm X" placeholders
// with REAL company-vault data when available. Only fall back to a
// Bid-Team Action note when a specific field is genuinely missing.
//
// The renderer never invents data — it only emits what's actually in
// the vault. When a field is null/empty, that specific cell falls back
// to a short Bid-Team Action note for THAT field only, preserving the
// rest of the section's substantive content.

// Helper: emits "VALUE" if present, else "Bid-Team Action: confirm LABEL"
function vaultField(value: string | number | null | undefined, label: string): string {
  if (value === null || value === undefined) return `Bid-Team Action: confirm ${label}`;
  const s = typeof value === "string" ? value.trim() : String(value);
  return s.length > 0 ? s : `Bid-Team Action: confirm ${label}`;
}

// Helper: emits a comma-joined string from an array, or a fallback note
function vaultList(values: string[] | null | undefined, label: string): string {
  if (!values || values.length === 0) return `Bid-Team Action: confirm ${label}`;
  return values.filter((v) => v && v.trim().length > 0).join(", ") || `Bid-Team Action: confirm ${label}`;
}

function buildCoverAndSummaryFallback(input: AIBidWriterInput): string {
  // PR #259 — vault-aware Cover Letter and Executive Summary
  // fallback. Same pattern as PR #257's company-and-experience
  // treatment: pulls real data from input.companyVault (Company
  // table) and from input.projects (top-scored project anchor)
  // when available. Falls back to "Bid-Team Action: confirm X"
  // ONLY for fields that are genuinely missing.
  const v = input.companyVault ?? {};
  const companyName = v.name?.trim() || "the firm";
  const tenderTitle = input.tenderTitle?.trim() || "the captioned tender";
  const clientName = input.clientName?.trim() || "the client";

  // Cover letter contact-block — pulled from vault. Each line is
  // suppressed when the corresponding vault field is null/empty.
  const contactBlockLines: string[] = [];
  if (v.address) contactBlockLines.push(v.address);
  const contactBits: string[] = [];
  if (v.phone) contactBits.push(`Tel: ${v.phone}`);
  if (v.email) contactBits.push(v.email);
  if (v.website) contactBits.push(v.website);
  if (contactBits.length > 0) contactBlockLines.push(contactBits.join(" | "));
  // Tax/registration line — Claude's PATH cover letter shows
  // "TIN: 0064637886 | VAT Reg. No.: 15480320805 | Category 1
  // (Grade I), Ethiopian Construction Authority"
  const regBits: string[] = [];
  if (v.tin) regBits.push(`TIN: ${v.tin}`);
  if (v.vat) regBits.push(`VAT Reg. No.: ${v.vat}`);
  if (v.licenseGrade) regBits.push(v.licenseGrade);
  if (regBits.length > 0) contactBlockLines.push(regBits.join(" | "));
  if (v.gmName) {
    contactBlockLines.push(`${v.gmName}, ${v.gmTitle ?? "General Manager"}${v.gmLicense ? ` (License ${v.gmLicense})` : ""}`);
  }
  const contactBlock = contactBlockLines.length > 0
    ? contactBlockLines.join("\n")
    : "";

  // Cover-letter subject line — uses tender reference if present,
  // matching Claude's pattern: "[RFQ# 2026-024 Hope Urban
  // Planning Architectural and Engineering Consultancy PLC]"
  const subjectLine = `Technical Proposal — ${tenderTitle}`;

  // Cover-letter opening paragraph — names a comparable project
  // when one is available in input.projects. Falls back to a
  // pointer to Section B when no projects are in scope.
  const projectsBlock = (input.projects ?? "").trim();
  // Try to extract the first project name + value from the
  // projects string (which is formatted by expertProofLine /
  // projectProofLine in proposal-intelligence.ts). Look for the
  // first line that contains a currency amount.
  const projectAnchorMatch = projectsBlock.match(/^([^\n]+?(?:ETB|USD|EUR|GBP)[^\n]+)/m);
  const openingParagraph = projectAnchorMatch
    ? `${companyName} submits this Technical Proposal for ${tenderTitle}. The same team that delivered ${projectAnchorMatch[1].slice(0, 200)} is proposed for this engagement, ensuring continuity of methodology and proven delivery.`
    : `${companyName} submits this Technical Proposal for ${tenderTitle}. Comparable project anchor: see Section B Featured Project Cards for the firm's prior comparable assignments and the same-team continuity proposed for this engagement.`;

  // Executive Summary lead — same evidence-anchored opening
  // pattern Claude uses ("We have already delivered this
  // assignment...").
  const execSummaryLead = projectAnchorMatch
    ? `**${companyName} has already delivered this assignment.** ${projectAnchorMatch[1].slice(0, 200)} demonstrates the firm's capacity for the exact scope this tender requires. The same lead team is proposed for this engagement.`
    : `${companyName} submits this Technical Proposal for ${tenderTitle}. The firm's portfolio of comparable assignments is detailed in Section B; the proposed team and methodology are aligned to ${clientName}'s evaluation criteria.`;

  return [
    "# Cover Letter",
    `Subject: ${subjectLine}`,
    `To: ${clientName}`,
    "",
    contactBlock || "_Bid-Team Action: confirm contact block (registered address, tel, email, website, TIN, VAT, license category, signatory) before submission._",
    "",
    openingParagraph,
    "",
    "The proposed team, comparable previous roles, and team-to-project mapping are detailed in Section A.4 and A.5. Section B presents the featured project portfolio with full client references, contract values, and testimony references.",
    "",
    `We confirm enclosed appendices and the signature block. The proposal is submitted in compliance with all stated requirements; commercial-terms compliance is addressed in the Compliance Matrix.`,
    v.gmName ? `\nSincerely,\n\n${v.gmName}\n${v.gmTitle ?? "General Manager"}${v.gmLicense ? `\nLicense ${v.gmLicense}` : ""}\n${companyName}` : "",
    "",
    "# Executive Summary",
    execSummaryLead,
    "",
    "Our proposal addresses each evaluation criterion stated in the tender's evaluation methodology: Section A demonstrates corporate capacity; Section B presents directly comparable past performance; Section C details the technical approach and methodology; Section D presents value-added capabilities, certifications, and the formal declaration of eligibility.",
    "",
    `${companyName} confirms full compliance with all stated requirements, team availability for the engagement window, and adherence to the tender's submission and commercial terms.`,
  ].filter((s) => s !== "").join("\n\n");
}

// ── Section B helpers — build real project cards from evidence text ──────────

function buildSectionBPortfolioOverview(input: AIBidWriterInput): string {
  const v = input.companyVault ?? {};
  const companyName = v.name?.trim() || "the firm";
  // Count evidence lines in the projects string as a rough portfolio size proxy
  const projectLines = (input.projects ?? "").split("\n").filter((l) => l.trim().length > 20);
  const count = projectLines.length > 0 ? `${projectLines.length}+` : "multiple";
  return `${companyName} brings a portfolio of ${count} comparable project assignments relevant to this tender. Each featured project below demonstrates the firm's direct capacity for the scope items evaluated in this tender. See Sections B.2 and B.3 for the two most comparable assignments; the full portfolio is summarised in the downstream project table.`;
}

function buildSectionBFeaturedCards(input: AIBidWriterInput): string[] {
  // Parse the projects evidence string to extract structured card data.
  // The projects string is formatted by projectProofLine in proposal-intelligence.ts
  // as multi-line blocks. We extract the first two blocks and format them as
  // real Markdown tables rather than empty "see downstream" stubs.
  const projectsText = (input.projects ?? "").trim();
  if (!projectsText) {
    return [
      "## B.2 Featured Project 1",
      "Bid-Team Action: populate with the most directly comparable project — client, location/scale, duration, contract value, testimony reference, services provided, and why it demonstrates capacity for this tender.",
      "## B.3 Featured Project 2",
      "Bid-Team Action: populate with the second most comparable project using the same format.",
    ];
  }

  // Split on double-newline or "---" separator to isolate project blocks
  const blocks = projectsText.split(/\n{2,}|^-{3,}$/m).map((b) => b.trim()).filter((b) => b.length > 40);

  const makeCard = (block: string, num: number): string => {
    // Extract fields via regex — these match the proof-line format:
    // "Project: NAME", "Client: X", "Value: Y", "Sector: Z", etc.
    const field = (label: string) => {
      const m = block.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]\\s*(.+)`, "i"));
      return m ? m[1].trim().slice(0, 200) : null;
    };
    const name = field("Project|Name|Title") ?? block.split("\n")[0].slice(0, 100).replace(/^#+\s*/, "");
    const client = field("Client");
    const value = field("Value|Contract");
    const sector = field("Sector|Type");
    const duration = field("Duration|Period|Timeline|Year");
    const services = field("Services|Scope|Deliverables|Activities");
    const location = field("Location|Country|Region");

    const rows: string[] = [
      "| Field | Detail |",
      "|---|---|",
      `| Project name | ${name} |`,
      client ? `| Client | ${client} |` : `| Client | Bid-Team Action: confirm client name |`,
      location ? `| Location/Scale | ${location} |` : "",
      duration ? `| Duration | ${duration} |` : `| Duration | Bid-Team Action: confirm |`,
      value ? `| Contract value | ${value} |` : `| Contract value | Bid-Team Action: confirm |`,
      services ? `| Services provided | ${services.slice(0, 180)} |` : "",
      sector ? `| Sector | ${sector} |` : "",
    ].filter(Boolean);

    const why = `**Why this anchors this tender:** The ${name} engagement demonstrates the firm's capacity for the core scope items required by this tender. The proposed lead team includes the same experts who delivered this assignment. Bid-Team Action: add a 2–3 sentence tailored narrative before submission.`;

    return [`## B.${num} Featured Project ${num - 1}`, rows.join("\n"), why].join("\n\n");
  };

  const card1 = blocks.length >= 1 ? makeCard(blocks[0], 2) : [
    "## B.2 Featured Project 1",
    "Bid-Team Action: populate with the most directly comparable project.",
  ].join("\n\n");

  const card2 = blocks.length >= 2 ? makeCard(blocks[1], 3) : [
    "## B.3 Featured Project 2",
    "Bid-Team Action: populate with the second most comparable project.",
  ].join("\n\n");

  return [card1, card2];
}

function buildCompanyAndExperienceFallback(input: AIBidWriterInput): string {
  const v = input.companyVault ?? {};
  const companyName = v.name?.trim() || input.clientName || "the firm";

  // ── A.1 Company Background — built from real vault data ──────────────
  // When founding year, headcount, license grade are present, emit a
  // proper paragraph naming them. Falls through to "Bid-Team Action"
  // ONLY for fields that are genuinely missing.
  const a1Parts: string[] = [];
  a1Parts.push(`**${companyName}**${v.legalName && v.legalName !== v.name ? ` (legal: ${v.legalName})` : ""}`);
  if (v.foundingYear) a1Parts.push(`founded ${v.foundingYear}`);
  if (v.headcount) a1Parts.push(`${v.headcount} professionals on staff`);
  if (v.licenseGrade) a1Parts.push(`holds ${v.licenseGrade} licence grade`);
  if (v.country) a1Parts.push(`registered in ${v.country}`);
  const a1Sentence = a1Parts.length >= 2
    ? `${a1Parts[0]} is a professional consultancy ${a1Parts.slice(1).join(", ")}.`
    : `${companyName} is a professional consultancy operating in the sector. Bid-Team Action: confirm founding year, licence grade, headcount, and registration country before submission.`;

  const a1ServicesSentence = v.serviceLines && v.serviceLines.length > 0
    ? `Core service lines include: ${v.serviceLines.join(", ")}.`
    : "";
  const a1SectorsSentence = v.sectors && v.sectors.length > 0
    ? `Sector experience spans: ${v.sectors.join(", ")}.`
    : "";
  const a1Profile = v.profileSummary?.trim()
    ? v.profileSummary.trim()
    : "";

  // ── A.2 Corporate Information Table — real values per row ────────────
  // PR S FIX — Build the table as ONE string with single-newline row
  // separators. The previous version pushed each row as a separate
  // array element joined later with "\n\n" — markdown table parsers
  // treat blank lines as table-end, so only the FIRST row rendered
  // as a table and every subsequent row leaked into the body text
  // with the next heading bleeding into the cell. Real output showed
  //   "| Registered address | Bid-Team Action: ... — # A.3 Core Service Lines"
  // exactly because of this double-newline-separator bug.
  const a2Table = [
    "| Field | Detail |",
    "|---|---|",
    `| Legal name | ${vaultField(v.legalName ?? v.name, "legal name")} |`,
    `| Registration number | ${vaultField(v.registrationNumber, "registration number")} |`,
    `| TIN | ${vaultField(v.tin, "TIN")} |`,
    `| VAT | ${vaultField(v.vat, "VAT")} |`,
    `| Registered address | ${vaultField(v.address, "registered address")} |`,
    `| Country | ${vaultField(v.country, "country")} |`,
    `| Phone | ${vaultField(v.phone, "phone")} |`,
    `| Email | ${vaultField(v.email, "email")} |`,
    `| Website | ${vaultField(v.website, "website")} |`,
    `| General Manager | ${vaultField(v.gmName, "GM name")}${v.gmTitle ? `, ${v.gmTitle}` : ""}${v.gmLicense ? ` (License ${v.gmLicense})` : ""} |`,
    `| Founding year | ${vaultField(v.foundingYear, "founding year")} |`,
    `| Staff headcount | ${vaultField(v.headcount, "staff headcount")} |`,
    `| Licence grade | ${vaultField(v.licenseGrade, "licence grade")} |`,
  ].join("\n");

  // ── A.3 Core Service Lines — actual list ─────────────────────────────
  const a3Body = v.serviceLines && v.serviceLines.length > 0
    ? v.serviceLines.map((s) => `- ${s}`).join("\n")
    : "Bid-Team Action: confirm the firm's core service lines relevant to this tender before submission.";

  return [
    "# Section A: Company Profile",
    "## A.1 Company Background",
    a1Sentence,
    a1Profile,
    a1ServicesSentence,
    a1SectorsSentence,
    "## A.2 Corporate Information Table",
    a2Table,
    "## A.3 Core Service Lines",
    a3Body,
    "## A.4 Proposed Project Team",
    "The proposed team is built from the firm's reviewed expert library. See Section A.4 deterministic Proposed Team table built downstream from the reviewed expert pool.",
    "## A.5 Team-to-Project Experience Mapping",
    "Each proposed expert is mapped to a previous comparable project — see deterministic Team-to-Project Mapping table built downstream.",
    "",
    "# Section B: Relevant Experience",
    "## B.1 Portfolio Overview",
    buildSectionBPortfolioOverview(input),
    ...buildSectionBFeaturedCards(input),
    "## B.4 Additional Projects",
    "See deterministic project portfolio table built downstream.",
    "## B.5 Client References",
    "See deterministic Client References table built downstream.",
  ].filter((s) => s !== "").join("\n\n");
}

function buildAdditionalAndDeclarationFallback(input: AIBidWriterInput): string {
  const v = input.companyVault ?? {};
  const companyName = v.name?.trim() || "the firm";
  const tenderTitle = input.tenderTitle?.trim() || "the captioned tender";

  // ── D.3 Professional Certifications — real compliance lines ──────────
  const d3Body = v.complianceLines && v.complianceLines.length > 0
    ? v.complianceLines.map((c) => `- ${c}`).join("\n")
    : "Bid-Team Action: confirm registration / certificate numbers and dates before submission. The Knowledge Vault should hold the firm's ISO certifications, professional body memberships, and donor compliance records.";

  // ── D.4 Declaration of Eligibility — names a real GM if available ───
  const d4Body = v.gmName
    ? `**${companyName}** declares that it meets all eligibility requirements stated in this tender. Signed: ${v.gmName}${v.gmTitle ? `, ${v.gmTitle}` : ", General Manager"}${v.gmLicense ? ` (License ${v.gmLicense})` : ""}.`
    : `**${companyName}** declares that it meets all eligibility requirements stated in this tender. Bid-Team Action: confirm signature block (GM name, title, licence) before submission.`;

  // ── Declaration — formal close with named GM ─────────────────────────
  const declarationBody = v.gmName
    ? `We, ${v.legalName ?? companyName}, hereby declare that this Technical Proposal has been prepared specifically in response to ${tenderTitle}. All information provided is accurate and supported by documentary evidence available on request. Signed: ${v.gmName}${v.gmTitle ? `, ${v.gmTitle}` : ", General Manager"}${v.gmLicense ? ` (License ${v.gmLicense})` : ""}, on behalf of ${companyName}.`
    : `We, ${companyName}, hereby declare that this Technical Proposal has been prepared specifically in response to ${tenderTitle}. All information provided is accurate and supported by documentary evidence available on request. Bid-Team Action: confirm signature block (GM name, title, licence) before submission.`;

  return [
    "# Section D: Additional Information",
    "## D.1 Value to the Client",
    "See deterministic Value Framework table built downstream.",
    "## D.2 In-House Capabilities Beyond Minimum Scope",
    "Bid-Team Action: confirm in-house capabilities (geotechnical lab, BIM, GIS, drone survey, in-house lab testing, etc.) before submission. The Knowledge Vault should hold these capability records.",
    "## D.3 Professional Certifications and Affiliations",
    d3Body,
    "## D.4 Declaration of Eligibility",
    d4Body,
    "",
    "# Appendix Register",
    "- Appendix A: Company Registration Documents and Licences",
    "- Appendix B: Audited Financial Statements",
    "- Appendix C: Curricula Vitae of Proposed Experts",
    "- Appendix D: Project References and Client Letters",
    "- Appendix E: Project Photos, Drawings and Completion Evidence",
    "",
    "# Declaration",
    declarationBody,
  ].filter(Boolean).join("\n\n");
}
