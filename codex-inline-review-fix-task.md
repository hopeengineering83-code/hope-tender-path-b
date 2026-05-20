# Codex Task: Resolve All GitHub Inline Review Threads for Hope Tender App

Repository:

hopeengineering83-code/hope-tender-path-b

## Mission

Fix all currently unresolved GitHub inline review threads in the app repository.

Do not guess.
Do not apply random fixes.
Do not weaken readiness, matching, source-grounding, export, or validation gates.
Fix the code so frontend and backend behavior agree.
Work from latest `main` only.

---

## Operating Rules

1. Before editing, inspect:
   - current branch
   - latest `main` HEAD SHA
   - latest 10 commits
   - `git status`
   - open PRs
   - current inline review threads if available

2. Create a new branch from latest `main`.

3. Do not overwrite unrelated files.

4. Fix the underlying code, not only the tests.

5. Preserve safety gates:
   - no unreviewed evidence counted as reviewed
   - no unselected matches treated as selected
   - no strategy-only tender file treated as official RFP
   - no unsupported facts in generated proposals
   - no export-ready status for placeholders or replacement-control records

6. Run all checks before final response:

```bash
npm run typecheck
npm test
npm run build
```

7. If any command fails, fix the failure and rerun all three.

8. Final response must include:

   * branch name
   * latest main SHA used
   * modified files
   * each inline review thread fixed
   * tests added/updated
   * exact command results
   * remaining risks or manual actions

---

# Open PRs with Inline Review Threads

The latest review scan found unresolved inline review threads in these PRs:

* PR #402
* PR #401
* PR #400
* PR #399
* PR #367
* PR #323
* PR #322

No inline review threads were found in these open PRs:

* PR #332
* PR #313
* PR #312
* PR #262

Treat the list below as the mandatory fix inventory.

---

# Priority Order

Fix in this order:

1. PR #402 — current build/proposal input wiring correctness
2. PR #401 — Generate Docs frontend/backend mismatch
3. PR #400 — domain detection and selected-match gating
4. PR #399 — sector routing / normalized labels / regex regressions
5. PR #367 — metadata autofill correctness
6. PR #323 — matching diagnostics and strict-domain regressions
7. PR #322 — strict-family matching, quantity parsing, and selection limits

---

# PR #402 — Fix AI Proposal Input Wiring and Ingestion-Readiness Regressions

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/402](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/402)

## Thread 402.1

Priority: P2
File:

```text
app/api/tenders/[id]/ai-proposal/route.ts
```

Lines:

```text
459–460
```

Problem:

`reviewedExpertCount` and `reviewedProjectCount` are currently derived from:

```ts
experts.length
projects.length
```

But those arrays can include unreviewed fallback matches when no reviewed records are available.

This makes the Proposal Intelligence Contract report reviewed evidence as present when it is not actually reviewed.

Risk:

The AI proposal generator may treat unreviewed evidence as reviewed and generate overconfident claims.

Required fix:

Count only records where:

```ts
trustLevel === "REVIEWED"
```

Expected implementation concept:

```ts
const reviewedExpertCount = experts.filter((expert) => expert.trustLevel === "REVIEWED").length;
const reviewedProjectCount = projects.filter((project) => project.trustLevel === "REVIEWED").length;
```

Use actual object shapes in the route. Do not invent fields if names differ. Inspect the model/types first.

Required tests:

Add or update a test proving:

* reviewed counts exclude unreviewed fallback experts
* reviewed counts exclude unreviewed fallback projects
* the AI writer contract receives reviewed counts, not total fallback counts

---

# PR #401 — Normalize RequirementType, Refine Domain Detection, and Tighten Generate Gating Logic

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/401](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/401)

## Thread 401.1

Priority: P1
File:

```text
app/dashboard/tenders/[id]/tender-detail.tsx
```

Lines:

```text
790–791
```

Problem:

The UI enables Generate Docs when:

```text
selectedExpertCount === 0
selectedProjectCount === 0
totalExpertMatches > 0
totalProjectMatches > 0
```

But the backend rejects this state with:

```text
NO_EXPERT_MATCHES_SELECTED
NO_PROJECT_MATCHES_SELECTED
```

Risk:

Users see an enabled button that deterministically fails with HTTP 422.

Required fix:

The frontend Generate Docs gate must require selected matches when the tender requires experts/projects.

Allowed recovery path:

Only allow generation without selected matches if the backend route itself will safely auto-select/promote reviewed matches and the UI message says that explicitly.

Preferred fix:

Use selected reviewed match counts for readiness.

Expected condition concept:

```ts
const selectedReviewedExpertMatches = expertMatches.filter(
  (match) => match.isSelected && match.trustLevel === "REVIEWED"
);

const selectedReviewedProjectMatches = projectMatches.filter(
  (match) => match.isSelected && match.trustLevel === "REVIEWED"
);
```

Then require these counts when relevant requirement types exist.

## Thread 401.2

Priority: P1
File:

```text
app/dashboard/tenders/[id]/tender-detail.tsx
```

Lines:

```text
788–789
```

Problem:

Reviewed-count gating counts reviewed matches across all matches, not only selected matches.

Backend validates reviewed status only among selected matches and rejects:

```text
ALL_EXPERTS_UNREVIEWED
ALL_PROJECTS_UNREVIEWED
```

Risk:

A reviewed but unselected row can make the UI green even if every selected row is still draft.

Required fix:

Compute reviewed status only inside selected matches.

Required tests:

Add or update UI/readiness tests proving:

* total matches alone do not enable Generate Docs
* reviewed but unselected matches do not enable Generate Docs
* selected but unreviewed matches do not enable Generate Docs
* selected reviewed expert/project matches enable Generate Docs when other gates pass

---

# PR #400 — Refine Doc-Generation Gating and Tighten Domain Detection

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/400](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/400)

## Thread 400.1

Priority: P1
File:

```text
lib/engine/requirement-constraints.ts
```

Lines:

```text
44–47
```

Problem:

Domain tags are lost when sector scope appears only in `GENERAL` requirements while expert/project rows are generic.

Example:

```text
GENERAL: hospital construction and supervision scope
PROJECT_EXPERIENCE: provide similar projects
```

Current behavior:

`domainTags` may be empty and `strictDomain` becomes false.

Risk:

Hard domain exclusion in `lib/engine/matching.ts` is bypassed and unrelated-domain matches may be selected.

Required fix:

Do not ignore legitimate sector scope in `GENERAL` blindly.

Implement balanced domain scoping:

* Ignore administrative/general submission-only wording.
* Preserve scope-bearing `GENERAL` text when it contains real sector/domain cues near project scope terms.
* Include domain-bearing types like `COMPANY_PROFILE` and `ELIGIBILITY` where appropriate.
* Avoid false ICT from administrative terms such as “digital submission platform”.

Required tests:

* GENERAL hospital scope + generic project requirement must produce healthcare/hospital domain tag.
* GENERAL digital submission wording must not produce ICT domain tag.
* COMPANY_PROFILE with sector wording must contribute domain tag.
* ELIGIBILITY with sector-specific license wording must contribute domain tag.

## Thread 400.2

Priority: P2
File:

```text
app/dashboard/tenders/[id]/tender-detail.tsx
```

Lines:

```text
785–786
```

Problem:

Generate Docs can be enabled when matches exist but none are selected or reviewed.

Risk:

Guaranteed backend failure.

Required fix:

Same as PR #401:

* require selected matches where required
* require selected reviewed matches where full proposal requires reviewed evidence
* do not use total match count as sufficient readiness

## Thread 400.3

Priority: P2
Status: Outdated but still conceptually relevant
File:

```text
lib/engine/requirement-constraints.ts
```

Line:

```text
70
```

Problem:

ICT detection lost genuine `online platform` / `digital platform` cases.

Required fix:

Restore platform detection only for genuine ICT/software/platform scope, not generic submission portals.

Good patterns should detect:

```text
develop an online platform
deploy digital case management platform
software platform implementation
MIS/ERP/CRM platform
```

Bad patterns should not detect:

```text
submit through digital platform
upload documents via online portal
digital submission only
```

Required tests:

* “develop an online platform” => ICT
* “submit through an online platform” => not ICT
* “digital submission portal” => not ICT

## Thread 400.4

Priority: P1
Status: Outdated but still conceptually relevant
File:

```text
lib/engine/requirement-constraints.ts
```

Line:

```text
70
```

Problem:

Bare `erp` / `crm` regex tokens can match unrelated words such as:

```text
enterprise
```

Required fix:

Use word boundaries:

```regex
\bERP\b
\bCRM\b
```

or lower-case-safe equivalent.

Required tests:

* `ERP implementation` => ICT
* `CRM system` => ICT
* `enterprise development` => not ICT due to `erp`
* `microcredit program` => not ICT due to `crm`

## Thread 400.5

Priority: P2
Status: Outdated but still conceptually relevant
File:

```text
lib/engine/requirement-constraints.ts
```

Original line:

```text
44
```

Problem:

`COMPANY_PROFILE` is excluded from domain-bearing requirement types even though extractor emits that type.

Required fix:

Include `COMPANY_PROFILE` in domain-bearing source types when it contains actual sector scope.

## Thread 400.6

Priority: P1
Status: Outdated but still conceptually relevant
File:

```text
lib/engine/requirement-constraints.ts
```

Line:

```text
70
```

Problem:

`it\s+system` lacks leading word boundary, so:

```text
permit system
```

can match as ICT.

Required fix:

Use boundary-safe expression:

```regex
\bit\s+system\b
```

Required tests:

* `IT system implementation` => ICT
* `permit system` => not ICT

## Thread 400.7

Priority: P2
Status: Outdated but still conceptually relevant
File:

```text
lib/engine/requirement-constraints.ts
```

Original line:

```text
44
```

Problem:

`ELIGIBILITY` is excluded from domain-bearing requirement types even though extraction emits it for license/permit/certificate clauses.

Required fix:

Include `ELIGIBILITY` when eligibility wording contains sector-specific license/certification/permit context.

## Thread 400.8

Priority: P2
File:

```text
app/dashboard/tenders/[id]/tender-detail.tsx
```

Lines:

```text
783–784
```

Problem:

Reviewed evidence is checked among all matches, not selected matches.

Required fix:

Same as PR #401:

```ts
selected && reviewed
```

must be the relevant readiness unit.

---

# PR #399 — Proposal Generation Sector Routing and Regex Regressions

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/399](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/399)

## Thread 399.1

Priority: P1
File:

```text
lib/engine/matching.ts
```

Lines:

```text
347–348
```

Problem:

New sector conflict regexes contain uppercase tokens:

```text
HAZOP
P&ID
KYC
AML
Basel
```

But the tested text is lowercased before regex matching and regexes lack `/i`.

Risk:

Oil/gas and financial conflict penalties are skipped.

Required fix:

Either:

* add `/i` flags, or
* lower-case regex tokens, or
* normalize both sides consistently.

Required tests:

* lower-case `hazop` still matches oil/gas conflict
* lower-case `kyc`, `aml`, `basel` still match financial conflict
* conflict penalty applies as expected

## Thread 399.2

Priority: P2
File:

```text
lib/engine/proposal-intelligence.ts
```

Line:

```text
640
```

Problem:

Agriculture detection is unreachable because earlier water/irrigation branch returns first.

Example:

```text
irrigation scheme for agriculture
```

is classified as water before agriculture branch runs.

Required fix:

Reorder sector detection or make agriculture-specific irrigation patterns take precedence over general water irrigation.

Required tests:

* `agricultural irrigation scheme` => Agriculture / Irrigation
* `urban water supply irrigation unrelated` should not false classify as agriculture unless agriculture terms exist
* pure water supply => Water & Sanitation

## Thread 399.3

Priority: P2
File:

```text
lib/engine/proposal-quality-scorer.ts
```

Lines:

```text
180–184
```

Problem:

`detectSector` returns keys:

```text
port
financial
telecoms
```

but `SECTOR_VOCAB` does not define those keys.

Risk:

Sector vocabulary scoring becomes generic/neutral and does not enforce domain depth.

Required fix:

Add matching `SECTOR_VOCAB` entries for:

```text
port
financial
telecoms
```

or make returned keys match existing vocabulary keys.

Required tests:

* port proposal checks maritime/terminal/berth vocabulary
* financial proposal checks KYC/AML/Basel/IFRS/core banking vocabulary
* telecoms proposal checks RF/spectrum/LTE/5G/backhaul vocabulary

## Thread 399.4

Priority: P2
File:

```text
lib/engine/work-plan-timeline.ts
```

Line:

```text
118
```

Problem:

Financial timeline branch does not match normalized sector label:

```text
Financial Services & Banking
Financial Services / Banking
```

Required fix:

Add normalized label matching to branch condition.

## Thread 399.5

Priority: P2
File:

```text
lib/engine/work-plan-timeline.ts
```

Line:

```text
110
```

Problem:

Oil/gas timeline branch does not match normalized sector label:

```text
Oil & Gas / Petroleum Engineering
Oil & Gas / Petroleum
```

Required fix:

Add normalized label matching to branch condition.

## Thread 399.6

Priority: P2
File:

```text
lib/engine/methodology-tables.ts
```

Line:

```text
222
```

Problem:

Oil/gas methodology rows do not trigger from normalized oil/gas sector label.

Required fix:

Match labels such as:

```text
oil & gas
oil and gas
petroleum engineering
petroleum
```

## Thread 399.7

Priority: P2
File:

```text
lib/engine/sector-vocabulary-enricher.ts
```

Lines:

```text
135–136
```

Problem:

Oil/finance vocabulary detection misses normalized labels:

```text
Oil & Gas / Petroleum
Financial Services / Banking
```

Required fix:

Add normalized label support.

## Thread 399.8

Priority: P2
File:

```text
lib/engine/sector-vocabulary-enricher.ts
```

Lines:

```text
133–137
```

Problem:

Building-sector vocabulary routing was removed/regressed.

Required fix:

Restore building/facilities branch.

Expected labels to match:

```text
Building Design & Construction Supervision
Building
Facilities
Architecture
Architectural
MEP
Structural
```

## Thread 399.9

Priority: P2
File:

```text
lib/engine/benchmark-tables.ts
```

Line:

```text
732
```

Problem:

Oil/gas value-framework branch misses normalized oil/gas labels.

Required fix:

Add normalized oil/gas label patterns.

## Thread 399.10

Priority: P2
File:

```text
lib/engine/beyond-spec-tables.ts
```

Line:

```text
186
```

Problem:

Financial beyond-spec routing misses normalized financial sector label.

Required fix:

Match:

```text
financial services
banking
financial services / banking
financial services & banking
```

## Thread 399.11

Priority: P2
File:

```text
lib/engine/benchmark-tables.ts
```

Line:

```text
738
```

Problem:

Financial value-framework branch misses normalized financial label.

Required fix:

Same as Thread 399.10.

## Thread 399.12

Priority: P2
File:

```text
lib/engine/beyond-spec-tables.ts
```

Line:

```text
179
```

Problem:

Oil/gas beyond-spec tables miss normalized oil/gas label.

Required fix:

Same as Thread 399.9.

## Thread 399.13

Priority: P2
File:

```text
lib/engine/proposal-intelligence.ts
```

Lines:

```text
644–645
```

Problem:

New `Financial Services & Banking` and `Telecoms & Broadband` labels are effectively unreachable because earlier branches return first.

Required fix:

Reorder or consolidate inferSector branches so normalized labels are reachable.

Required tests:

* KYC/AML/core banking => Financial Services / Banking
* spectrum/LTE/5G/backhaul => Telecoms & Broadband
* these labels trigger downstream vocabulary/timeline/table routing

## Thread 399.14

Priority: P2
File:

```text
lib/engine/proposal-benchmark-audit.ts
```

Line:

```text
19
```

Problem:

Benchmark depth regexes lost boundary-safe forms and can reintroduce substring false positives.

Required fix:

Restore word-boundary-safe short acronym matching.

Examples needing boundaries:

```text
WASH
MIS
ERP
ICT
MEP
HVAC
OPD
ICU
GIS
ESIA
ESMP
KYC
AML
IFRS
LTE
```

Required tests:

* `submission` must not trigger MIS
* `optimisation` must not trigger MIS
* `district` must not trigger ICT
* `Washington` must not trigger WASH
* real `WASH`, `MIS`, `ERP`, `ICT` still match

## Thread 399.15

Priority: P2
File:

```text
lib/engine/proposal-intelligence.ts
```

Lines:

```text
513–517
```

Problem:

Banking/telecom criteria regexes are case-sensitive.

Risk:

Lowercase tender text like:

```text
kyc
aml
ifrs
lte
5g
```

is missed.

Required fix:

Use `/i` or normalize case.

Required tests:

* lowercase financial acronyms detected
* uppercase financial acronyms detected
* lowercase telecom acronyms detected
* uppercase telecom acronyms detected

## Thread 399.16

Priority: P2
File:

```text
lib/engine/universal-tender-taxonomy.ts
```

Line:

```text
121
```

Problem:

Shipping terminal cue was removed from port/logistics taxonomy.

Required fix:

Restore detection for:

```text
shipping terminal
terminal
container terminal
cargo terminal
port terminal
```

without causing unrelated terminal false positives where possible.

## Thread 399.17

Priority: P2
File:

```text
lib/engine/proposal-strengthening-sections.ts
```

Line:

```text
48
```

Problem:

ICT selector lost word-boundary guards for short abbreviations:

```text
MIS
ERP
ICT
```

Risk:

Words like `submission` or `optimisation` can trigger ICT strengthening.

Required fix:

Restore boundary-safe matching.

Required tests:

* `submission schedule` => not ICT
* `optimisation of process` => not ICT
* `ICT strategy`, `MIS development`, `ERP implementation` => ICT

---

# PR #367 — Auto-Fill Client Name During Engine Run

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/367](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/367)

## Thread 367.1

Priority: P1
File:

```text
tests/tender-metadata.test.ts
```

Line:

```text
89
```

Problem:

Test expects `inferTenderMetadata()` to extract `clientName` from an unlabeled uppercase header, but extractor only supports labeled patterns like:

```text
Client:
Procuring Entity:
Employer:
```

Risk:

Test suite remains red.

Required fix options:

Option A — implement parser support for organization-name header fallback.

Option B — remove or adjust unsupported assertion.

Preferred fix:

Implement conservative parser support only if safe.

Rules for header fallback:

* Do not extract generic all-caps headings like `TERMS OF REFERENCE`, `REQUEST FOR PROPOSAL`, `TECHNICAL PROPOSAL`, `TABLE OF CONTENTS`.
* Extract only organization-like names containing entity keywords such as:

  * Ministry
  * Authority
  * Agency
  * Commission
  * Corporation
  * Foundation
  * Ventures
  * University
  * Hospital
  * Bureau
  * Office
  * Institute
  * Enterprise
  * PLC
  * Ltd
  * Company
* Avoid extracting project titles as clients.

Required tests:

* unlabeled organization header => clientName only if organization-like
* generic RFP header => no clientName
* labeled procuring entity still works

## Thread 367.2

Priority: P2
File:

```text
lib/engine/auto-fill-tender-metadata.ts
```

Lines:

```text
69–72
```

Problem:

Autofill does not persist `clientContactTitle`, even though extractor and schema support it.

Required fix:

If `inferTenderMetadata()` returns `clientContactTitle`, write it to the tender when current stored value is empty/invalid.

Do not overwrite valid manual edits.

Required tests:

* extracted contact title persists when empty
* valid existing title is preserved

---

# PR #323 — Matching Diagnostics / Strict-Domain Logic

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/323](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/323)

## Thread 323.1

Priority: P1
File:

```text
app/api/tenders/[id]/matching-diagnostics/route.ts
```

Lines:

```text
47–48
```

Problem:

The endpoint selects non-existent field:

```text
evidenceSummary
```

from both:

```text
tenderExpertMatch
tenderProjectMatch
```

Prisma will throw at runtime.

Required fix:

Remove `evidenceSummary` from selects or replace with existing schema fields.

Inspect Prisma schema before changing.

Required tests:

* diagnostics endpoint query does not include non-existent fields
* diagnostics endpoint returns 200 with basic match rows

## Thread 323.2

Priority: P1
File:

```text
lib/engine/requirement-constraints.ts
```

Lines:

```text
43–44
```

Problem:

Strict-domain detection uses all requirements, so admin text such as “digital platform” can falsely tag a tender as ICT.

Required fix:

Same domain-scoping fix described in PR #400:

* preserve actual scope text
* ignore administrative/submission-only text
* include relevant capability/domain-bearing requirement types

## Thread 323.3

Priority: P1
File:

```text
lib/engine/matching.ts
```

Lines:

```text
291–292
```

Problem:

Profile-derived selection counts are not capped when `exactSelectionLimit` returns 0.

Risk:

Large extracted quantities can select too many records.

Required fix:

Apply hard caps consistently:

```text
max experts: 20
max projects: 15
```

or use existing constants if already defined.

Required tests:

* profile count 50 experts clamps to 20
* profile count 50 projects clamps to 15
* normal small counts pass

## Thread 323.4

Priority: P2
File:

```text
lib/engine/requirement-constraints.ts
```

Lines:

```text
34–37
```

Problem:

`parseCount` returns the first quantity mention instead of maximum valid count.

Required fix:

Parse all valid quantity mentions and return max.

Avoid false positives from years, percentages, form numbers, section numbers, dates.

Required tests:

* `2 experts and 5 projects` returns correct scoped counts
* multiple project counts returns maximum project count
* `2024 project references` does not return 24

## Thread 323.5

Priority: P1
Duplicate of 323.1
File:

```text
app/api/tenders/[id]/matching-diagnostics/route.ts
```

Required fix:

Remove non-existent `evidenceSummary`.

## Thread 323.6

Priority: P1
Duplicate of 323.2
File:

```text
lib/engine/requirement-constraints.ts
```

Required fix:

Restrict strict-domain tagging to domain-relevant requirements.

## Thread 323.7

Priority: P1
Duplicate of 323.3
File:

```text
lib/engine/matching.ts
```

Required fix:

Cap profile-derived limits.

## Thread 323.8

Priority: P2
Duplicate of 323.4
File:

```text
lib/engine/requirement-constraints.ts
```

Required fix:

Parse max quantity, not first occurrence.

## Thread 323.9

Priority: P2
File:

```text
lib/engine/matching.ts
```

Line:

```text
640
```

Problem:

Rationale always emits:

```text
Required-family coverage: x/1
```

when no required families were detected.

Risk:

False low-coverage diagnostics.

Required fix:

When no required families exist, omit family coverage or emit:

```text
Required-family coverage: not applicable
```

Do not classify as low coverage.

Required tests:

* no required families => no false 0/1 warning
* required families exist => real coverage emitted

## Thread 323.10

Priority: P2
File:

```text
lib/engine/requirement-constraints.ts
```

Lines:

```text
43–44
```

Problem:

Role-signal counts are extracted from full combined requirement text, so project/reference wording like “architectural design projects” can inflate `expertCount`.

Required fix:

Derive role signals from expert/staff/personnel requirement types only.

Required tests:

* project wording containing architect/engineer does not create expertCount
* staff/personnel rows create expertCount

---

# PR #322 — Matching Engine Family Coverage and Scope Quantities

PR:

[https://github.com/hopeengineering83-code/hope-tender-path-b/pull/322](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/322)

## Thread 322.1

Priority: P1
File:

```text
lib/engine/matching.ts
```

Lines:

```text
439–441
```

Problem:

When `hardFamilyGate` is enabled, `eligible` is set to `strictEligible` if non-empty, even if fewer than `limit`.

Risk:

Selection silently under-fills required expert/project counts despite additional above-threshold candidates.

Required fix:

Do not blindly replace the eligible pool.

Correct logic should:

* select strict-eligible candidates first
* fill remaining slots only if safe policy allows
* preserve strict-family requirements
* do not fill with unrelated records if strict match is mandatory

Required tests:

* strictEligible length < limit and safe related candidates exist => fills allowed remaining slots
* strictEligible empty and strict family mandatory => does not select unrelated candidates silently
* warning/blocker emitted for strict shortfall

## Thread 322.2

Priority: P1
Duplicate of 322.1
File:

```text
lib/engine/matching.ts
```

Required fix:

Fill remaining slots after strict-family prefilter, safely.

## Thread 322.3

Priority: P1
File:

```text
lib/engine/matching.ts
```

Line:

```text
441
```

Problem:

Strict-family gate falls back to unrelated pool when no strict records exist.

Risk:

False-positive auto-selection for strict-sector tenders.

Required fix:

If strict family is mandatory and no strict records exist, return no strict selection and surface blocker/warning.

Do not auto-select unrelated matches.

## Thread 322.4

Priority: P1
File:

```text
lib/engine/scope-policy.ts
```

Line:

```text
36
```

Problem:

Quantity inference can misread headings like:

```text
Form 3 Project References
```

as a requirement for 3 projects.

Required fix:

Require explicit quantity intent words near the number:

```text
at least
minimum
no less than
must provide
shall provide
not fewer than
```

Do not infer from form names or section headings.

## Thread 322.5

Priority: P1
Duplicate of 322.3
File:

```text
lib/engine/matching.ts
```

Required fix:

Do not fall back to unrelated pool in strict-family mode.

## Thread 322.6

Priority: P1
File:

```text
lib/engine/matching.ts
```

Line:

```text
437
```

Problem:

Strict mode accepts candidates matching generic families but missing required strict family.

Required fix:

When strict family is required, require overlap with at least one strict required family, not merely any required family.

Required tests:

* candidate matches generic family only => rejected in strict mode
* candidate matches strict required family => eligible

## Thread 322.7

Priority: P1
File:

```text
lib/engine/matching.ts
```

Line:

```text
155
```

Problem:

`criticalFamilyMismatchPenalty` returns zero whenever there is any shared family.

Risk:

Candidate matching only generic family avoids penalty while missing required strict family.

Required fix:

Apply penalty if any required strict family is missing, even with partial generic overlap.

Required tests:

* required ICT + generic, candidate only generic => penalty applies
* required ICT, candidate ICT => no strict-family penalty

## Thread 322.8

Priority: P1
Duplicate of 322.4
File:

```text
lib/engine/scope-policy.ts
```

Required fix:

Guard inferred quantity against heading/reference numbers.

## Thread 322.9

Priority: P2
File:

```text
lib/engine/scope-policy.ts
```

Line:

```text
78
```

Problem:

Heuristic inference can override smaller explicit `requiredQuantity` using:

```ts
Math.max(taggedQuantity, inferQuantityFromText(...))
```

Risk:

Weak regex inference upsizes limits beyond structured extraction.

Required fix:

Do not let weak inference override explicit structured quantities unless confidence is high.

Recommended:

* if explicit valid `requiredQuantity` exists, use it
* use heuristic only when structured quantity is absent
* or require strong explicit-language evidence

## Thread 322.10

Priority: P2
File:

```text
lib/engine/requirement-constraints.ts
```

Lines:

```text
33–36
```

Problem:

`parseCount` returns first regex hit.

Required fix:

Parse all quantity mentions and return the maximum valid count.

## Thread 322.11

Priority: P2
Duplicate of 322.10
File:

```text
lib/engine/requirement-constraints.ts
```

Required fix:

Parse all quantity mentions before choosing fallback count.

## Thread 322.12

Priority: P1
File:

```text
lib/engine/requirement-constraints.ts
```

Lines:

```text
45–48
```

Problem:

`requiredQuantity` fallback bypasses explicit-language guard.

Risk:

Mis-tagged quantities, row numbers, form indices can become real staffing/project limits.

Required fix:

Preserve explicit-language guard.

Only use `requiredQuantity` as count if the source text supports explicit quantity intent.

Required tests:

* form number does not become required count
* explicit minimum count does become required count

## Thread 322.13

Priority: P2
File:

```text
lib/engine/matching.ts
```

Lines:

```text
277–278
```

Problem:

Profile-derived limits skip hard maximum bounds.

Required fix:

Clamp to existing hard caps:

```text
20 experts
15 projects
```

or existing constants.

## Thread 322.14

Priority: P2
Duplicate of 322.13
File:

```text
lib/engine/matching.ts
```

Required fix:

Clamp profile-derived limits.

## Thread 322.15

Priority: P1
File:

```text
lib/engine/requirement-constraints.ts
```

Line:

```text
29
```

Problem:

Project-count regex lacks numeric word boundaries.

Example:

```text
2024 project references
```

can match as:

```text
24 project references
```

Required fix:

Add numeric boundaries around count tokens.

Required tests:

* `2024 project references` does not return 24
* `at least 4 project references` returns 4

## Thread 322.16

Priority: P2
File:

```text
lib/engine/requirement-constraints.ts
```

Line:

```text
42
```

Problem:

Expert/project counts are derived from all requirement rows in one blob.

Risk:

Quantity phrases from unrelated requirement types leak into wrong limit.

Required fix:

Derive counts from type-scoped requirement text:

* expert counts from EXPERT / KEY_STAFF / PERSONNEL type rows
* project counts from PROJECT_EXPERIENCE / SIMILAR_ASSIGNMENT type rows
* do not cross-contaminate

Required tests:

* project count does not set expert count
* expert count does not set project count

---

# Consolidated Test Requirements

Add or update tests covering these full groups.

## A. Reviewed and Selected Match Gating

Required cases:

1. Total matches > 0 but selected matches = 0 => Generate Docs disabled.
2. Selected matches exist but all are unreviewed => Generate Docs disabled.
3. Reviewed matches exist but are unselected => Generate Docs disabled.
4. Selected reviewed matches exist => Generate Docs may enable if other gates pass.
5. AI writer contract reviewed counts exclude unreviewed fallback records.

## B. Domain Detection

Required cases:

1. Hospital scope in GENERAL + generic project requirement => healthcare domain preserved.
2. Digital submission platform => ICT not triggered.
3. Develop online platform => ICT triggered.
4. ERP/CRM word-boundary false positives blocked.
5. Permit system does not match IT system.
6. COMPANY_PROFILE sector wording contributes domain tag.
7. ELIGIBILITY sector license wording contributes domain tag.

## C. Sector Routing

Required cases:

1. Agriculture irrigation classified as agriculture, not water.
2. Oil/gas normalized labels route to:

   * timeline
   * methodology tables
   * benchmark tables
   * beyond-spec tables
   * vocabulary enricher
3. Financial normalized labels route to:

   * timeline
   * benchmark tables
   * beyond-spec tables
   * vocabulary enricher
4. Telecom normalized labels route to vocabulary scoring and proposal intelligence.
5. Building sector label routes to building vocabulary enrichment.

## D. Regex Boundary Safety

Required false positives:

1. `submission` must not trigger MIS.
2. `optimisation` must not trigger MIS.
3. `district` must not trigger ICT.
4. `Washington` must not trigger WASH.
5. `enterprise` must not trigger ERP.
6. `permit system` must not trigger IT system.

Required positives:

1. `MIS development` triggers ICT.
2. `ERP implementation` triggers ICT.
3. `ICT system` triggers ICT.
4. `WASH programme` triggers water/sanitation.
5. `IT system implementation` triggers ICT.

## E. Matching Selection Limits

Required cases:

1. Profile expert count 50 clamps to 20.
2. Profile project count 50 clamps to 15.
3. Form heading `Form 3 Project References` does not infer project count.
4. `2024 project references` does not infer 24.
5. Explicit `at least 4 project references` returns 4.
6. Multiple valid quantities return maximum.
7. Expert and project counts are type-scoped.

## F. Strict-Family Matching

Required cases:

1. Required strict family missing => penalty applies even with generic overlap.
2. Candidate matching only generic family fails strict-family gate.
3. Candidate matching strict required family passes.
4. StrictEligible below limit fills only with policy-allowed related candidates.
5. No strict match exists => no unrelated auto-selection; warning/blocker emitted.

## G. Metadata Autofill

Required cases:

1. Labeled procuring entity extracts client.
2. Safe organization-like header extracts client only if implemented conservatively.
3. Generic RFP/ToR/table-of-contents headings do not extract client.
4. `clientContactTitle` persists when extracted and empty.
5. Existing valid contact title is preserved.

## H. Matching Diagnostics

Required cases:

1. Diagnostics endpoint does not select non-existent Prisma fields.
2. No required families => no false `0/1` low-coverage warning.
3. Required families present => real coverage computed.

---

# Implementation Guidance

## Prefer Shared Helpers

Avoid repeated regex fixes scattered across files if a shared helper is better.

Consider shared utilities for:

```text
normalized sector label matching
safe acronym regex
domain-bearing requirement type classification
explicit quantity intent detection
selected reviewed match counting
```

## Do Not Hide Problems

Do not make panels green by weakening logic.

Correct green state requires:

* selected matches where required
* selected reviewed matches where full proposal requires reviewed evidence
* source/domain matching is correct
* quantities are not inflated by headings/form numbers
* sector routing matches normalized labels
* AI contract counts reviewed evidence honestly

---

# Required Commands

Run:

```bash
npm run typecheck
npm test
npm run build
```

If `npm run build` fails only because required environment variables such as `DATABASE_URL` or `SESSION_SECRET` are missing in the Codex environment, document that clearly and prove typecheck/tests passed.

Do not mark the code ready if TypeScript or tests fail.

---

# Final Report Format

Return exactly this structure:

````markdown
## Branch

<name>

## Latest main SHA used

<sha>

## Inline review threads fixed

### PR #402
- [x] 402.1 — <summary>

### PR #401
- [x] 401.1 — <summary>
- [x] 401.2 — <summary>

### PR #400
- [x] 400.1 — <summary>
...

## Modified files

- <file>
- <file>

## Tests added or updated

- <test file>
- <test file>

## Commands run

```bash
npm run typecheck
# result

npm test
# result

npm run build
# result
```

## Remaining risks

* <none or exact risks>

## Manual follow-up

* <none or exact actions>

```

Do not claim all review threads are resolved unless each issue above is fixed or the PR/thread is confirmed obsolete because the code path no longer exists on latest main.
```
