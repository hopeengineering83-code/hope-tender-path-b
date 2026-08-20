# hope-tender-path-b — Claude Code Project Guide

This is a Next.js 15 App Router application for tender/bid management.
Stack: Next.js 15 · React 19 · TypeScript · Prisma 6.19 (PostgreSQL) · Tailwind CSS · Vercel.

---

## Establishing current state

Do not trust a state summary written into this file — a pinned SHA, test count,
or "recent merges" list is stale the moment the next commit lands, and an agent
that believes one reports a green tree it never ran. Establish state by running
it, and quote what you actually saw:

```bash
npx prisma generate                 # first — the client must match schema.prisma
npx tsc --noEmit
npx next lint
npm test                            # DB-integration suites need the env below
npx next build
```

DB-integration suites are skipped, or fail closed, without a real PostgreSQL and
`RUN_DB_INTEGRATION=true`. They are the only tests that prove behavior rather
than source text, so a run without them is not a full run. If the database
process dies mid-run, every DB suite fails at once with "Can't reach database
server" — that is an environment failure, not a code regression; restart it and
re-run before believing the result.

Open work and cross-agent scope: `operator_handoff.md` Active Workboard.

## Product goal (canonical — owner-stated, supersedes earlier phrasing)

Read `OWNER_AUTOMATION_CONTRACT.md` first. It is the current workflow authority.

The owner uploads exactly two things:

1. **Company Vault documents and Brand Assets — ONCE.** Not per tender.
2. **Tender files — every time**, for each new tender.

Everything else is automatic **except exactly two owner actions**: AI Analyze and
Run Engine. Those two are deliberate manual gates, not stages to be automated
away. Every other stage runs on durable server-owned workers through to a
downloadable ZIP.

```
Vault + Brand Assets (once)  ─┐
                              ├─→ extraction + source verification   AUTOMATIC
Tender files (every tender)  ─┘
        │
        ├─→ AI Analyze                                    MANUAL (owner clicks)
        │
        ├─→ Run Engine                                    MANUAL (owner clicks)
        │
        └─→ Build Plan → evidence matching → DOCX generation →
            validation → PDF finalization → package
            reconciliation → ZIP readiness                        AUTOMATIC
```

The browser may display progress and recovery controls, but it must not own orchestration or need to remain open. Automatic continuation may stop only for fail-closed review conditions defined in `OWNER_AUTOMATION_CONTRACT.md`, including unreadable/conflicting sources, unsupported claims, legal-authority decisions, exhausted external credentials after bounded retry, and final owner approval.

Apart from AI Analyze and Run Engine, no Generate, Confirm, Repair, Validate, Finalize, Refresh, or Re-check click may be mandatory on the normal path. Exceptional recovery may exist only inside collapsed Diagnostics and Recovery.

**Do not "fix" AI Analyze or Run Engine into automatic stages.** Earlier revisions
of this section described them as server-owned and non-mandatory, which
contradicted `OWNER_AUTOMATION_CONTRACT.md` — the file this document names as the
workflow authority — and sent successive sessions back and forth undoing each
other. The contract and the shipped code agree: both actions require explicit
owner authority. `createAnalysisJob()` rejects any call without a
`manualAuthority` bearing `source: "manual-ai-analyze"` and a matching
`actorUserId`; the engine route requires `manualRequested: true`;
`continueSuccessfulAnalysis()` always returns `MANUAL_ENGINE_REQUIRED`;
extraction ends at `EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED`. Negative
regression tests pin all of it.

## Resuming after an interrupted session — ask first

If a session ended because a tool/usage limit was reached, **do not resume work on
the next session automatically.** Report the current state and wait for Hope's
explicit go-ahead before editing, committing, or pushing anything.

Hope continues the work with a different coding tool while a limit is in effect.
An agent that picks its previous task back up on refresh is therefore editing on
top of changes it has not seen, which is how two tools end up fixing the same
thing at once. That has already happened on PR #1175: `1d746caa` and `f8dd0eb5`
were concurrent independent fixes to the same test-contention bug, and nothing
was lost only because they were merged rather than force-pushed.

This applies to autonomous continuation only. A fresh instruction from Hope is
always permission to proceed.

## Priority order for all sessions

1. Read `OWNER_AUTOMATION_CONTRACT.md` and `operator_handoff.md` Active Workboard before starting — do not overlap another agent's scope. More than one agent pushes to this repo, so re-fetch and confirm the exact head before editing, and rebase rather than discarding someone else's commits.
2. Establish current state by running the commands above. Quote real output; never restate a status line from a document as if you had verified it.
3. Take the next item from the `operator_handoff.md` Active Workboard. That file is the open-work list — this one is not.

This section previously listed four specific engineering tasks (wiring
`TenderFactsLedger` into consumers, writing `scripts/backfill-tender-facts-ledger.ts`,
adding `CONDITIONAL_OR_UNSCHEDULED` to the canonical resolver, configuring the
800×1280 tablet E2E viewport). All four already shipped, and the stale list sent
each new session to redo finished work. Keep this section about *how* to pick up
work; track *what* is open in `operator_handoff.md`, which has a defined update
ritual and one owner per branch.

## AI provider policy — STRICT ZERO-PAID

This deployment must never send a request that could produce a charge. That is
enforced structurally, not by remembering which keys to leave unset.

**Automatic fallback chain (the only providers the app may contact):**

```
Gemini → Groq → Mistral → Z.ai → [OpenRouter, only with a verified ":free" model]
       → deterministic draft fallback (non-AI, never final-export eligible)
```

**Paid-access providers — enumerated, reported on, never contacted:**

```
Cerebras · OpenAI · Together · DeepSeek · Anthropic
```

They stay visible in health and diagnostics as `BILLING_BLOCKED`. Hiding them
would be the wrong fix: an operator needs to see that a key is present and
deliberately unused, not wonder where the provider went.

**Full canonical enumeration** (fixes each provider's rank; the first five are
the automatic chain):

```
Gemini → Groq → Mistral → Z.ai → OpenRouter → Cerebras → OpenAI → Together → DeepSeek → Anthropic
```

Defined once in `lib/ai-provider-catalog.cjs`. Every fallback sequence, health
endpoint, admin diagnostic, environment check, doc table and test derives from
it — never from a second literal. `scripts/reconcile-gap-closure.mjs` audits
this and fails on drift.

### The three enforcement layers

1. **Automatic order.** Only `ZERO_PAID_AUTOMATIC_ORDER` is reachable by the
   fallback chain. Paid providers are not deprioritised, they are unreachable.
2. **Paid-access exclusion.** `providerAutomaticEligibility()` refuses a paid
   provider before a request body exists, so a key left in the environment
   cannot spend money.
3. **Billing lockout.** A provider that answers with a payment/balance/quota
   -required error leaves the automatic chain for the life of the process.
   A cooldown would expire and try again; "this account has no money" does not
   clear on its own. Only an operator clears it.

`AI_ZERO_PAID_MODE` defaults **ON**. A missing or misspelt value fails closed to
"spend nothing", never open to "spend money".

### Model identity is discovered, not asserted

`listAccountModels()` asks each provider which models the account may actually
call, and the resolved model is checked against that list. Registry defaults are
**preference hints**, validated live — never a claim that a name exists. A local
copy of a third party's catalogue is a second authority on a question only they
can answer, and it goes stale the moment they retire a snapshot.

Each free provider's registry default equals the head of its
`freeTierPreference`, so a source default and the live-verified choice can never
contradict each other.

### Verified capability, not key presence

A provider is **usable for AI Analyze** only after a real structured-extraction
test passes. Connectivity proves the key and the route, not the capability.
`checkAiProviderHealth()` reports `healthy` / `degraded` / `unhealthy`, and
production readiness passes only on `healthy`.

Diagnostics run the same adapter, model and configuration as the real workload
(`lib/ai-provider-capability-test.ts` → `callProvider`), inside
`runAsDiagnostic()` so their observations never impose cooldowns on real work.

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
