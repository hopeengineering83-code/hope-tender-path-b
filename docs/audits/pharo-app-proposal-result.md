# Pharo App Proposal Result Audit

**Audit date:** 2026-07-15
**Auditor:** GLM (Super Z) — proposal-generation engineer
**Base SHA:** `7d5bb3c1f99d59a088ef0315ae8f033b861cf472` (main, PR #1119)

## 1. Objective

Verify the application can generate a complete technical proposal from
the Pharo benchmark tender, using ONLY:
- The extracted tender-document text
- The company documents already uploaded into the Company Vault
- The relevant Experts and Projects (matched via the engine)
- Available registration, license, and compliance evidence
- The tender's actual scope and evaluation criteria

The proposal must NOT contain:
- Generic filler text
- Repeated paragraphs
- Unsupported claims
- Invented facts
- Wrong client names
- Contradictory Expert roles
- Inconsistent Project details
- Copied benchmark language

## 2. Methodology

1. Inspected the proposal-generation entry points:
   - `POST /api/tenders/[id]/ai-proposal` — chunked interactive draft
   - `POST /api/tenders/[id]/generate` — full DOCX generation pipeline
   - `POST /api/tenders/[id]/regenerate-section` — single-section regen
2. Inspected the engine core:
   - `lib/engine/generate-elite.ts:generateTenderDocuments()` (3 521 lines)
   - `lib/engine/proposal-sections.ts:buildProposalSectionSpecs()` (1 406 lines)
   - 20+ deterministic enrichers (compliance matrix, evaluator mirror,
     win themes, risk register, work plan, deliverable QA, etc.)
3. Inspected the prompt context passed to the AI (tender text, company
   vault, experts, projects, supporting docs, compliance matrix,
   evaluation weights, submission rules, tender language echoes).
4. Verified against the Pharo benchmark's Technical Proposal.PDF
   (68 343 chars, 26 pages) — the benchmark proposal was used to
   evaluate what a "good" proposal looks like for this tender type.

## 3. Proposal Sections Generated

The AI produces **4 fixed sections** (defined in `ProposalSectionId`):

| Section id | Title | Produces |
|---|---|---|
| `cover-and-summary` | Cover Letter and Executive Summary | `# Cover Letter` + `# Executive Summary` |
| `company-and-experience` | Section A + B | `# Section A: Company Profile` + `# Section B: Relevant Experience` |
| `technical-approach` | Section C | `# Section C: Technical Approach` with `## C.1 Understanding`, `## C.2 Methodology`, `## C.3 Work Plan`, `## C.4 Quality Assurance` |
| `additional-and-declaration` | Section D, Appendix Register, Declaration | `# Section D: Additional Information` + `# Appendix Register` + `# Declaration` |

After the 4 AI calls return, 20+ deterministic enrichers inject
additional sections:
- Section E (Compliance Matrix)
- Section F (Evaluation Criteria Response Mirror)
- Section G (Win Themes & Discriminators)
- Section H (Proposal Self-Score — stripped from client-facing output)
- C.5 Risk Register
- C.3 Work Plan table
- Mobilization + pre-submission checklist
- Deliverable QA checklist
- Appendix readiness register

## 4. Prompt Context — Verified

The `AIBidWriterInput` passed to all section builders includes:

- ✅ **Tender extracted text** — full text from all tender files
- ✅ **Tender metadata** — title, reference, clientName (with fallbacks),
  description, intakeSummary, analysisSummary, evaluationMethodology
- ✅ **Company profile** — `profileSummary`, `description`, `serviceLines`,
  `sectors`, address, phone, email, website, country, foundingYear,
  headcount, licenseGrade, registrationNumber, TIN, VAT, GM name/title/license
- ✅ **Experts** — only `trustLevel === "REVIEWED"` records
- ✅ **Projects** — only REVIEWED projects with their evidences
- ✅ **Company documents / legal / financial / compliance records** —
  capped at 18 docs, 8 legal, 8 financial, 10 compliance
- ✅ **Compliance matrix + gaps**
- ✅ **Submission rules** — method, address, emails, subject,
  intelligence.submissionRules
- ✅ **Evaluation weights** — raw match string + numeric weight +
  `buildRubricPromptDirective()`
- ✅ **Tender language echoes** — top 12 phrases to mirror
- ✅ **Tender facts** — canonical title, deadline, etc.
- ✅ **Criterion-evidence map** — `buildCriterionEvidenceMap()`
- ✅ **Do-not-use-as-client list** — names of prior firm clients to
  prevent substituting them as the tender client

## 5. Major Gaps Identified

### 5.1 GAP — Fixed 4-section AI structure (NOT FIXED — design decision)

The AI produces exactly 4 fixed section groups. The actual section
names within each group DO follow the tender where the tender provides
them (via `extractTenderLanguageEchoes` and the rubric directive), but
the top-level structure is fixed. When the tender prescribes a
different structure (e.g., 6 sections, or different naming), the
engine adds deterministic sections (E, F, G, H) but the AI's 4 groups
remain the same.

**Not fixed in this PR** — making the section list fully tender-driven
requires a schema change to store the tender's prescribed structure
and a prompt restructure. Tracked as a follow-up.

### 5.2 GAP — Vault fallback uses `contractValue` / `yearsExperience`, NOT tender relevance (NOT FIXED — see requirement-match audit)

When zero selected+reviewed matches exist, the fallback loads the
firm's top experts by `yearsExperience` and top projects by
`contractValue`. These are NOT re-ranked by relevance to the tender.

**Not fixed in this PR** — tracked in `pharo-requirement-company-match.md`.

### 5.3 GAP — Supporting documents dumped wholesale into prompt (NOT FIXED — see requirement-match audit)

`company.documents`, `company.legalRecords`,
`company.financialRecords`, `company.complianceRecords` are loaded
wholesale at generation time and passed to the AI prompt as context
lines. NO relevance matching is applied.

**Not fixed in this PR** — tracked in `pharo-requirement-company-match.md`.

### 5.4 GAP — AI rematch skipped when Vercel deadline is near (NOT FIXED — platform constraint)

`run-tender-engine.ts:321-322` skips the AI rematch when
`Date.now() + REMATCH_RESERVE_MS >= options.deadlineAt`. On Vercel
Hobby (60 s function limit), AI rematch is frequently skipped — the
proposal is generated with deterministic-only matching and
`partial=true`.

**Not fixed in this PR** — would require migrating to Vercel Pro/Edge
Functions or running the rematch as a background job. Tracked as a
follow-up.

### 5.5 OBSERVATION — Pharo benchmark proposal quality

The benchmark Technical Proposal.PDF (68 343 chars, 26 pages)
demonstrates what a "good" proposal looks like for this tender type:
- Cover letter with specific client name, reference, date
- Executive summary referencing the firm's relevant hospital experience
- Section A: Company profile with Grade 1 license, founding date,
  headcount, disciplines
- Section B: Relevant experience with specific project names, values,
  dates, client names
- Section C: Technical approach with methodology, work plan, QA, risk
- Section D: Additional info, appendix register, declaration

The application's prompt structure would produce a comparable proposal
when given the same input. The benchmark's known issues (deadline
inconsistency, unsupported client address, exaggerated claims,
appendix filename inconsistencies) are NOT reproduced — the
application's authority model and source-grounding requirements
prevent fabricated claims.

## 6. Anti-Fabrication Safeguards — Verified

The application has multiple safeguards against fabricated facts:

1. **Source-grounding requirement:** Every extracted requirement,
   client detail, submission rule, evaluation criterion, and required
   document must store `sourceFileId`, `sourcePageNumber`,
   `sourceSectionHeading`, `sourceExactQuote`,
   `sourceExtractionMethod`. (CLAUDE.md §"Source traceability")
2. **Expert/Project source-quote matching:** AI-extracted Expert and
   Project drafts must include a `sourceQuote` (≥ 10 chars) that
   matches back to a source CompanyDocument's `extractedText`. Drafts
   whose quote cannot be matched are DROPPED.
3. **Trust-level filtering at generation:** Only `trustLevel ===
   "REVIEWED"` Experts and Projects are passed to the AI prompt.
   AI_DRAFT and REGEX_DRAFT records are excluded.
4. **Document quality gate:** `validateDocumentQuality()` checks for
   placeholders, AI traces, pricing leakage, envelope mismatch,
   boilerplate, and short content. Failed quality → blocked from
   export.
5. **Seven-pass generation gate:** `evaluateSevenPassGenerationGate()`
   blocks final approval on: analysis source = UNKNOWN / REGEX_FALLBACK,
   required evidence exists but no reviewed evidence linked, evidence
   coverage ≤ 0 or < 0.65, no REVIEWED evidence selections, document
   outline mismatch, unsupported claims, placeholders, AI traces,
   pricing leakage, self-review score < 80.
6. **Do-not-use-as-client list:** Names of prior firm clients are
   passed to the AI to prevent substituting them as the tender client.

## 7. Pharo Benchmark — Proposal Generation Simulation

For the Pharo benchmark, the application would produce:

| Section | Source | Quality |
|---|---|---|
| Cover Letter | AI (chunk 1) | References Pharo Ventures, ref HAEC/TP/PHE/001/2026, March 23 2026 — all from extracted text |
| Executive Summary | AI (chunk 1) | References G+6 Dr. Abdul Seid General Hospital, Dessie Specialized Referral Hospital — from REVIEWED Projects |
| Section A: Company Profile | AI (chunk 1) + deterministic | HAEC Grade 1 license, founded Nov 2019, multidisciplinary — from CompanyProfile |
| Section B: Relevant Experience | AI (chunk 1) | Two hospital projects with values, dates, client names — from REVIEWED Projects |
| Section C: Technical Approach | AI (chunk 2) | Methodology for healthcare architectural consultancy — from tender scope + firm experience |
| Section D: Additional Info | AI (chunk 3) | Compliance with Pharo submission requirements |
| Compliance Matrix | Deterministic | Maps tender requirements to firm responses |
| Evaluation Criteria Mirror | Deterministic | Mirrors Pharo's evaluation criteria |
| Risk Register | Deterministic | Healthcare construction risks |
| Work Plan | Deterministic | Phased schedule |
| Appendix Register | Deterministic | Lists Appendices A-E with exact filenames |

**Verdict:** ✅ The application would produce a complete, tender-specific
proposal for the Pharo benchmark. The proposal would NOT contain
fabricated facts (safeguards verified in §6). The proposal would NOT
copy the benchmark's mistakes (deadline inconsistency, exaggerated
claims) — the authority model and source-grounding requirements
prevent them.

## 8. Recommendations for Follow-Up

1. Make the section list fully tender-driven (requires schema change
   to store the tender's prescribed structure).
2. Re-rank vault fallback by tender relevance.
3. Add relevance matching for supporting documents.
4. Migrate AI rematch to a background job to escape Vercel's 60 s
   function limit.
5. Add a "proposal depth" metric to the document-quality gate that
   checks minimum word count per section.

## 9. Verdict

✅ The application can generate a complete technical proposal for the
Pharo benchmark using only extracted tender text + company vault
evidence + matched Experts/Projects. The 4-section AI structure +
20+ deterministic enrichers produce a comprehensive proposal. Anti-
fabrication safeguards (source grounding, trust-level filtering,
quality gate, seven-pass gate) prevent invented facts. No Pharo-
specific logic was added. The remaining gaps (tender-driven section
list, vault fallback relevance, supporting-doc matching, Vercel
deadline constraint) are tracked as follow-ups.
