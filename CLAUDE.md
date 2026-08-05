# hope-tender-path-b — Claude Code Project Guide

This is a Next.js 15 App Router application for tender/bid management.
Stack: Next.js 15 · React 19 · TypeScript · Prisma 6.19 (PostgreSQL) · Tailwind CSS · Vercel.

---

## Current Main State (SHA: 63369f03)

- **tsc:** PASS (run `npx prisma generate` first to pick up new models)
- **lint:** PASS
- **build:** PASS
- **Tests:** 464 test files, 6000+ tests PASS
- **Main is stable.** All 5 clusters (A-E) from DECISIONS_NEEDED.md are resolved.
- **Recent merges:** #1029 (action icons), #1028 (screenshot contradictions), #1027 (generation/buildplan/export truth), #1026 (lifecycle truth), #1025 (canonical readiness counts).

## Product goal (canonical — owner-stated, supersedes earlier phrasing)

Read `OWNER_AUTOMATION_CONTRACT.md` first. It is the current workflow authority.

The owner uploads exactly two things:

1. **Company Vault documents and Brand Assets — ONCE.** Not per tender.
2. **Tender files — every time**, for each new tender.

The app must then do **everything else automatically**, through to a downloadable ZIP. AI Analyze and Run Engine are durable server-owned stages, not mandatory normal-path user actions.

```
Vault + Brand Assets (once)  ─┐
                              ├─→ extraction + source verification
Tender files (every tender)  ─┘
        │
        └─→ AI Analyze → Run Engine → Build Plan → evidence matching →
            DOCX generation → validation → PDF finalization → package
            reconciliation → ZIP readiness                 AUTOMATIC
```

The browser may display progress and recovery controls, but it must not own orchestration or need to remain open. Automatic continuation may stop only for fail-closed review conditions defined in `OWNER_AUTOMATION_CONTRACT.md`, including unreadable/conflicting sources, unsupported claims, legal-authority decisions, exhausted external credentials after bounded retry, and final owner approval.

No Generate, Confirm, Repair, Validate, Finalize, Refresh, Analyze, Run Engine, or Re-check click may be mandatory on the normal path. Exceptional recovery may exist only inside collapsed Diagnostics and Recovery.

Implementation state and every traced gate point: see task #124.

## Priority order for all sessions

1. Read `OWNER_AUTOMATION_CONTRACT.md` and `operator_handoff.md` Active Workboard before starting — do not overlap another agent's scope.
2. Wire `TenderFactsLedger` model into downstream consumers (UI, gates, BuildPlan, document generators).
3. Write + test backfill script (`scripts/backfill-tender-facts-ledger.ts`) to migrate legacy Tender scalars → TenderFactsLedger.
4. Add `CONDITIONAL_OR_UNSCHEDULED` status to canonical resolver + wire through STATUS_BADGE maps.
5. Run DB-integration tests with PostgreSQL to verify all clusters are truly resolved.
6. Run browser E2E tests at 800×1280 tablet viewport.

## Canonical Provider Order (NEVER change)

```
Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic
```

This is defined in `lib/ai-provider-catalog.cjs` `CANONICAL_AI_PROVIDER_ORDER`.
All docs, gates, health routes, and UI must match this order.
OCR is separate from normal AI routing.

## Frozen / Quarantined PRs

- **PR #937** — FROZEN. Never touch, merge, revive, rebase, or reuse.
- **PR #957** — QUARANTINED. Never touch.

## Key Architecture (current)

- **Authority model**: `lib/engine/tender-fact-authority.ts` — 5 authority states (SOURCE_GROUNDED, HUMAN_CONFIRMED_OPERATIONAL, NOT_STATED_IN_SOURCE, UNKNOWN, REJECTED_CANDIDATE)
- **Effective facts**: `lib/engine/effective-tender-facts.ts` + `lib/engine/effective-tender-context.ts` — single server-side resolver merging source-grounded + overrides + requirements
- **Draft vs final gates**: Draft work never blocked by metadata; final export requires grounding OR sufficient audit (reason ≥10 chars + confirmationBasis)
- **TenderFactsLedger**: `prisma/schema.prisma` — additive model for dynamic, extensible fact store (not yet wired into all consumers)
- **TenderSubmissionEmail**: Per-email source provenance (replaces pipe-joined string)
- **Operation gate**: `lib/engine/tender-operation-gate.ts` — operation-aware gate resolver
- **Source-driven detail**: `lib/engine/source-driven-tender-detail.ts` — source-driven tender detail panel

---

## Critical requirements

### Client / procuring-entity extraction

AI Analyze must extract and display **all available client details** from the tender document:

1. Procuring entity / client name
2. Full legal client name if different from display name
3. Donor / funding agency if any
4. Project owner / implementing agency if any
5. Procurement / reference number
6. Tender title / project title
7. Country
8. City / project location
9. Client address
10. Submission address
11. Contact person name
12. Contact title / role
13. Contact email(s)
14. Contact phone / mobile
15. Website / portal link if available
16. Submission email(s)
17. Required email subject line if specified
18. Pre-bid / contact channel
19. Client representative / authorized officer if specified
20. **Source page** and **source quote/snippet** for every extracted client field

**Rules:**

- Do **not** fill missing client fields with placeholders such as "Bid-Team to confirm", "unknown", "not specified", or "N/A" as if they are valid.
- If a field is missing from the tender source, mark it `MISSING_SOURCE` and require manual confirmation.
- If multiple client names appear, distinguish: procuring entity, project owner, funder/donor, implementing agency, and consultant/client contact.
- If the extracted client name is polluted by unrelated tender portal text, navigation text, old tender alerts, or unrelated tenders, flag it as **contaminated** and block final generation until corrected.
- Client/procuring entity, submission method, submission endpoint/email/address, and deadline are **critical fields** and must block final generation/export when missing or invalid.

---

### Tender page extraction quality

Before AI Analyze and document generation, the app must show a clear page-extraction status for every tender file.

For each uploaded tender document display:

1. File name
2. File type
3. Total pages detected
4. Pages successfully text-extracted
5. Pages OCR-extracted
6. Pages with no text / blank pages
7. Pages with low text density
8. Pages with extraction errors
9. Pages containing tables/forms
10. Pages containing images/scans
11. Pages containing submission instructions
12. Pages containing evaluation criteria
13. Pages containing required documents/forms
14. Pages containing client/contact/submission details
15. Page-level confidence score
16. Overall extraction score
17. Extracted character count
18. OCR used: yes/no
19. OCR model used if applicable
20. Warning if the document is only partially extracted

**Required UI — Extraction Quality panel:**

- Total pages: X
- Perfectly extracted pages: Y
- OCR pages: Z
- Failed/weak pages: N
- Extraction coverage: Y/X and percentage
- Low-confidence pages list
- Failed pages list
- Recommended action: Re-extract PDF / Run OCR / Upload clearer scan / Manually enter missing metadata / Continue only if extraction quality is acceptable

**Definition of "perfectly extracted page"** — a page counts as perfectly extracted only when:

- it has usable text,
- text density is above the configured threshold,
- no extraction error occurred,
- the page is not blank,
- the text is not only headers/footers/noise,
- if the page contains tables/forms, table/form text is captured well enough for requirement extraction.

---

### Generation gates

**AI Analyze gate:** may run on partial extraction, but the result must be clearly marked with one of:
`FULL_EXTRACTION_AI_ANALYZED` · `PARTIAL_EXTRACTION_AI_ANALYZED` · `OCR_REQUIRED` · `EXTRACTION_WEAK_REVIEW_REQUIRED` · `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`

If extraction is weak, AI Analyze must **not** silently produce a confident result.

**Build Plan gate:** must show "Submission plan cannot be trusted because required tender pages were not fully extracted" when submission-instruction/evaluation-criteria/required-document pages are missing or weak.

**Generate Docs gate** — blocked unless ALL of the following are met:

1. Page extraction is acceptable
2. Client/procuring details are extracted or manually confirmed
3. Mandatory requirements are extracted
4. Submission instructions are extracted
5. Required documents/forms are extracted or derived
6. Submission plan is built/confirmed

**Export / ZIP gate** — blocked when:

- page extraction is poor,
- total page count is unknown,
- important pages failed extraction,
- submission instructions/evaluation criteria/client details were not extracted,
- AI Analyze was based on incomplete extraction,
- required documents cannot be derived because pages are missing/weak.

---

### Source traceability

Every extracted requirement, client detail, submission rule, evaluation criterion, and required document must store:

- source file name
- page number
- section heading if available
- source quote/snippet
- extraction method: `text` / `OCR` / `manual`

---

### Audit and code areas to review and patch

- PDF/text extraction modules
- OCR modules
- AI Analyze route
- Tender metadata extraction
- Tender Detail panel
- Extraction Quality panel
- Analysis Quality panel
- Build Submission Plan logic
- Generate Docs gate
- Readiness scoring
- Export readiness gate
- Tests for extraction quality

---

### Acceptance criteria

1. The app shows total tender pages and how many pages were perfectly extracted.
2. The app shows weak/failed page numbers.
3. The app extracts client/procuring entity name correctly.
4. The app extracts all available client contact/submission details with source page/quote.
5. The app blocks generation when important tender pages are weak or missing.
6. The app blocks generation when client/procuring details are missing or contaminated.
7. The app does not use placeholders as valid metadata.
8. The app does not build an empty submission plan when requirements exist.
9. The app does not generate documents before extraction, requirements, client details, and submission plan are usable.
10. Regression tests prove that poor extraction cannot lead to confident AI Analyze, Build Plan, Generate Docs, or Final ZIP.
