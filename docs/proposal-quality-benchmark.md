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
