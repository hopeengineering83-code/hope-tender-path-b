# Proposal Quality Benchmark — reference scoring and the measurement blocker

Recorded 2026-08-29 against head `3cbceb25`. Benchmark material was supplied by
the owner as three files (tender source, company knowledge authority v3, and a
previously produced Claude/ChatGPT technical proposal).

Pharo is a **benchmark fixture only**. Nothing here may be hard-coded.

## What the benchmark tender actually requires

Read from the supplied source, not from memory:

| Fact | Value |
| --- | --- |
| Title | Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center |
| Client | Pharo Ventures · Addis Ababa, Ethiopia |
| Submission | Email only, PDF only |
| Deadline | **August 25, 2026, 5:00 PM Addis Ababa Time** |
| Email subject | `Technical Proposal for Pharo Ventures` |
| Financial proposal | **Explicitly NOT required** — "Do not generate a financial proposal" |
| Required document | `Technical Proposal.pdf` |
| Evaluation criteria | 5 criteria, **weights not provided** (must not block) |
| Scope | 6 items (facility identification → close-out) |
| Required sections | 8 (cover letter → annexes) |

## Reference proposal score: 92/100

| Axis | Score | Basis |
| --- | --- | --- |
| Tender fidelity | 16/20 | All 6 scope items answered as methodology 3.1–3.6; all 8 required sections present; financial-proposal denial correctly honoured; correct client, both emails, exact subject line. **Loses 4 for the wrong deadline (below).** |
| Evidence grounding | 18/20 | Hospital claims verified against the authority record; licence numbers and testimony references cited throughout. **Loses 2 for an internal count inconsistency (below).** |
| Technical methodology / depth | 19/20 | Site Assessment Matrix with five weighted criteria and real engineering values (CT slab loading ~2,000 kg, 3.0 m clinical clear height, 2.4 m corridors); IPC zoning / flow-mapping / materials gates; WHO ventilation with positive-negative pressure and HEPA; medical gas; radiation shielding; PACS and telehealth cabling; three-stage design review with named hold-points. |
| Evaluation responsiveness | 14/15 | Addresses all five stated criteria explicitly. |
| Team / project relevance | 10/10 | Same team credited on both prior hospitals; explicit team-to-project mapping section; biomedical engineer engaged because the tender names one. |
| Completeness | 5/5 | Cover letter, executive summary, Sections A–D, appendices, eligibility declaration. |
| Professional writing | 5/5 | Specific and confident; claims carry references. |
| Presentation / rendering | 5/5 | TOC with page numbers, structured tables, signed. |

### Defects in the reference — must NOT be reproduced

1. **Wrong submission deadline (critical, source contradiction).** The proposal
   states `March 25, 2026, 5:00 PM` and is dated `March 23, 2026`. The tender
   states **August 25, 2026**. A submission that misstates the deadline is a
   factual error against its own source.
2. **Internal count inconsistency.** "all **107** of its completed certified
   projects" against "**116** certified projects" used four times elsewhere.
   107 is *completed projects* and 116 is *certified projects* in the authority
   record — two different denominators presented as the same claim.

### Claims that ARE supported — do not "fix" these

An earlier reading of the extracted arrays (`projects: 114`, `experts: 28`)
suggested the headline figures were inflated. That reading was wrong, and the
distinction matters for any grounding rule written against this record: the
arrays are the *extracted and documented subset*, while `companyProfile` states
"more than 350 completed projects, with 116 certified and documented" and
"29 key experts and 35 total active staff". Both denominators are legitimate.
A verifier that compares a narrative claim against array length alone will
produce false accusations of fabrication.

Verified accurate against the authority record:
- G+6 Dr Abdul Seid General Hospital — 7,000 m², ETB 550,074,678.02
- Dessie Specialized Hospital — 2,800 m², ETB 125,000,000

## Benchmark hard-coding audit — clean

- `lib/engine/pharo-acceptance-fixture.ts` is imported by exactly one test
  (`tests/golden-path-release-acceptance.test.ts`, as
  `SANITIZED_HEALTHCARE_ACCEPTANCE_FIXTURE`). **No production path imports it.**
- `HEALTHCARE` is one of 20+ domains in `universal-tender-taxonomy.ts`.
- `tender-domain-instructions.ts` covers building, road/highway, water,
  geotechnical, sanitation, irrigation, supervision and healthcare.
- Remaining "Pharo" strings in `lib/` are explanatory comments recording why a
  rule exists (e.g. the client-name fidelity rule in `proposal-sections.ts`),
  not behaviour keyed to the fixture.

## Measurement blocker — App score NOT MEASURED

The App-side score cannot be produced in this environment, and no number is
offered in its place.

`.env` configures Cerebras as `CEREBRAS_BASE_URL=http://127.0.0.1:4599` with a
15-character key literal — this is `scripts/local-ai-provider.mjs`, the local
harness stub, not a vendor. The stub returns **hard-coded** requirements whose
`sourceQuote` values ("SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
"04-Compliance-Matrix.docx") belong to the harness's own two-envelope RFP
fixture. None of those strings occurs in the benchmark tender, and grounding
enforces verbatim quote containment against the source file, so AI Analyze
cannot even reach `AI_SUCCEEDED` on this tender — let alone draft prose whose
depth is worth scoring.

No other provider key is present, and the Preview's authenticated routes return
401 to this session, so the run cannot be performed there either.

**One owner action unblocks the whole objective:** provide a real provider key
to the environment running the pipeline — `GEMINI_API_KEY` is first in the
canonical order and has a free tier (`GROQ_API_KEY` or `MISTRAL_API_KEY` are
equivalent alternatives). The variable name is what matters here; the value must
never be pasted into chat or committed.

## Deterministic findings from the real tender — two fixed, and a correction

Running the real reader over the real tender measured **tender comprehension**
without any provider. Two live defects were found and fixed on this branch.

### Fixed: the client name was the label that asks for it

`Procuring Entity / Client Name` is the ordinary data-sheet row. The reader
matched only `procuring entity`, left the colon optional, and captured the rest
of the LABEL: the benchmark yielded the client `"/ Client Name"`, and the colon
form yielded `"/ Client Name: <real name>"`. Client identity prints on the cover
letter's "To:" line and gates final export, so this either hard-blocked a
correctly extracted tender or addressed the proposal to a fragment of its own
form. Fixed by consuming the compound tail as part of the label and requiring a
separator, with the tail bounded to labels ending in "name" so it cannot walk
into `Client Contact Email:` and return an address as the client.

### Fixed: the deadline was invented, and then not looked for again

`new Date("August, 2026, 5:00 PM")` returns **August 1st**. The benchmark's
summary row omits the day, so the tender acquired a deadline appearing in none
of its sentences — the 1st, where the document twice says the 25th. The reader
also stopped at its first candidate, so the complete date further down the file
was never reached. Dayless dates are now refused, every candidate is considered,
and three further gaps that left a tender with *no* deadline were closed:
the `" at "` connector, trailing sentence punctuation, and day-first numeric
dates. Genuinely ambiguous numeric dates (`05/11/2027`) are refused rather than
guessed. `extractSubmissionInstructions` was also collecting warnings into a
local array and returning only the instruction set, so "submission deadline not
detected" reached nobody.

### Correction: scope and criteria on this parser are NOT the quality lever

An earlier reading of the same parse reported "scope: 1 of 6 items" and
"evaluation criteria: 0 of 5" as defects starving the methodology and
evaluation-responsiveness axes. That framing was wrong and is corrected here so
it is not chased.

`TenderDocumentIntelligence.scopeOfServices`, `.technicalCriteria`,
`.eligibilityCriteria` and `.financialCriteria` have **no consumer anywhere** in
`lib/`, `app/` or `components/`. The criteria arrays are hard-coded `[]` at the
return and always have been. The parser is consumed — by
`effective-tender-facts.ts`, the fact-parity route and the intake detail panel —
but only for FACTS: title, client, deadline, submission method, emails, address,
financial-proposal requirement. Those are exactly the fields the two fixes above
touch.

The scope that actually reaches a generated document is built in
`tender-document-context.ts` from `requirements`, and requirements come from AI
Analyze. Evaluation criteria reach generation through
`extractDeepTenderComprehension` in `evaluation-criteria-extractor.ts`, which is
an AI call consumed by `generate-elite.ts` and the evaluator-simulation route.

So methodology depth and evaluation responsiveness — the two largest rubric axes,
35 points together — are gated on the AI path, not on this deterministic reader.
Populating those dead arrays would have been building an unused system, which is
the opposite of what the architecture needs. The provider key remains the
blocker for those axes.

## The real blocker is egress policy, not a missing key

Earlier notes in this file said the App could not be scored because no provider
key was configured. That was true but incomplete, and acting on it wastes a key.
Tested directly from this session:

| Provider host | Result |
| --- | --- |
| `api.mistral.ai` | **403 CONNECT denied by the egress proxy** |
| `api.groq.com` | **403 CONNECT denied** |
| `api.openai.com` | **403 CONNECT denied** |
| `api.cerebras.ai` | **403 CONNECT denied** |
| `openrouter.ai` | **403 CONNECT denied** |
| `generativelanguage.googleapis.com` | **reachable** — 403 *from Google* asking for an API key |

The five denials are recorded by the proxy itself as
`connect_rejected — gateway answered 403 to CONNECT (policy denial)`. The agent
proxy README is explicit that a 403 means the destination is not permitted by
the session's egress policy and must be reported rather than retried or routed
around. **A valid key for any of those five would still fail here.**

Gemini is the exception, and it is also first in the canonical provider order.
Its host answered from Google's own API — `PERMISSION_DENIED … Please use API
Key` — with no proxy denial recorded, which is an authentication response, not a
network block.

**So the one action that unblocks the benchmark in this environment is a
`GEMINI_API_KEY`** (Google AI Studio; a free tier exists). Any other provider
additionally requires its host to be added to the environment's egress policy.

A Mistral key supplied for this purpose could not be used and should be treated
as compromised and rotated: it was never written to a tracked file and never
entered git history, but it was transmitted in conversation.

