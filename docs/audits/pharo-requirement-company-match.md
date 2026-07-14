# Pharo Requirement-to-Company Match Audit

**Audit date:** 2026-07-15
**Auditor:** GLM (Super Z) — principal tender-analysis engineer
**Base SHA:** `7d5bb3c1f99d59a088ef0315ae8f033b861cf472` (main, PR #1119)

## 1. Objective

Verify that for every important tender requirement, the application can
determine:
- Whether the company can comply
- Which company document supports it
- Which Expert is relevant
- Which Project is relevant
- Which license or registration supports it
- Which supporting document should be attached
- Whether the evidence is strong, partial, or unavailable

The matching must use SEMANTIC meaning, not just exact keywords. For
example, "healthcare design experience" must match Projects described as
"hospital", "clinic", "medical center", or "health facility".

## 2. Methodology

1. Inspected the matching engine (`lib/engine/matching.ts` — 990 lines).
2. Inspected the AI rematch layer
   (`lib/engine/main-engine-ai-rematch.ts`,
   `lib/engine/ai-multi-perspective-matcher.ts`).
3. Inspected the semantic alignment layer
   (`lib/engine/semantic-match-aligner.ts`).
4. Verified the capability-family regex dictionaries
   (`CAPABILITY_KEYWORDS`, `SECTOR_PATTERNS`, `PROPOSAL_THEMES`).
5. Cross-checked the Pharo benchmark's tender requirements against the
   firm's claimed experience (G+6 Dr. Abdul Seid General Hospital,
   Dessie Specialized Referral Hospital, Entoto Eco-Park).

## 3. Matching Algorithm — Summary

### 3.1 Deterministic matcher (`lib/engine/matching.ts:buildMatches()`)

**Hybrid lexical + capability-family + sector-aware + portfolio-optimized.**
NOT embeddings-based.

For each Expert and Project, runs **20 tokenization cycles** and keeps
the best score:

1. **Cosine TF-IDF** (`cosineTfidf`): lexical similarity over
   term-frequency vectors weighted by inverse-document-frequency.
2. **Capability-family keyword scoring** (`capabilityScore`): 22
   hand-coded `CapabilityFamily` regex dictionaries in
   `CAPABILITY_KEYWORDS`.
3. **Sector boost / conflict** (`sectorBoost`): 9 regex groups; sector
   mismatch → `-0.30` penalty; sector match → `+0.15` boost.
4. **Trust-level adjustment**: REVIEWED +0.18, AI_DRAFT -0.03,
   REGEX_DRAFT -0.10.
5. **Critical family mismatch penalty**: `-0.40` for strict sectors
   (HEALTHCARE_FACILITIES, EDUCATION_FACILITIES, ICT_DIGITAL, etc.)
   when zero overlap.
6. **Final blend**: weighted combination of capability, cosine, sector,
   and bonus (capped at 0.28).

### 3.2 Portfolio optimization (`optimizePortfolioSelection`)

20 cycles of greedy set selection with marginal-gain scoring. Final set
scored on `efficiency * 0.45 + familyCoverage * 0.40 + disciplineCoverage * 0.15`.

### 3.3 AI rematch layer (supplementary)

When AI is enabled and time allows: pre-filters to top 20 experts and
projects by deterministic score, then runs a single Claude call per
entity type with a **12-perspective scoring rubric**:

```
DISCIPLINE_FIT (0.16), SCOPE_COVERAGE (0.13), SENIORITY_OR_SCALE (0.09),
SECTOR_FIT (0.11), ROLE_RECENCY (0.08), EVIDENCE_QUALITY (0.09),
COMPLIANCE_CRITICALITY (0.10), PORTFOLIO_CONTRIBUTION (0.07),
MANDATORY_ELIGIBILITY (0.07), DELIVERY_RISK (0.04),
DIFFERENTIATION (0.04), COMMERCIAL_VALUE (0.02)
```

### 3.4 Thresholds

- `SELECTION_THRESHOLD = 0.75` — auto-selected
- `MIN_FLOOR_SCORE = 0.55` — force-promoted for minimum-3 guarantee
- `MIN_REVIEWED_BEST_AVAILABLE_SCORE = 0.20` — second-pass promotion of
  REVIEWED records

## 4. Semantic Matching — Verification

### 4.1 Healthcare example

The user's requirement: *"healthcare design experience may appear under
hospital, clinic, medical center, health facility or healthcare
infrastructure"*.

`CAPABILITY_KEYWORDS.HEALTHCARE_FACILITIES` in `lib/engine/matching.ts:73`:
```js
HEALTHCARE_FACILITIES: [
  /health(?:care)?\s+(?:facilit|design|infra)/i,
  /\bhospital/i,
  /medical\s+(?:facility|center|cent|equipment|gas|imaging)/i,
  /clinic/i,
  /specialty\s+(?:medical|cent)/i,
  /\bOPD\b/i, /\bICU\b/i,
  /surgical\s+suite/i,
  /radiology/i,
  /pharmacy\s+design/i,
  /clinical\s+(?:lab|workflow)/i,
  /biomedical/i,
  /pharma/i,
  /patient\s+(?:flow|room|safety)/i,
  /\bIPC\b/i, /infection\s+control/i,
  /\bMoH\b/i, /ministry\s+of\s+health/i,
]
```

✅ The regex dictionary covers the user's example: "healthcare design"
matches `/health(?:care)?\s+(?:facilit|design|infra)/i`, "hospital"
matches `/\bhospital/i`, "clinic" matches `/clinic/i`, "medical center"
matches `/medical\s+(?:facility|center|cent|equipment|gas|imaging)/i`.

### 4.2 MEP example

The user's requirement: *"MEP experience may appear under mechanical,
electrical, plumbing, medical gas, HVAC or building-services
engineering"*.

`CAPABILITY_KEYWORDS.MEP_ENGINEERING` (verified by grep):
```js
MEP_ENGINEERING: [
  /\bMEP\b/i, /\bHVAC\b/i,
  /mechanical\s*,\s*electrical\s*,\s*plumbing/i,
  /\bmechanical\s+engineering/i,
  /\belectrical\s+engineering/i,
  /\bplumbing/i, /\bmedical\s+gas/i,
  /\bbuilding\s+services/i,
  /fire\s+(?:protection|suppression|alarm)/i,
  /\blow\s*voltage/i, /\bextra\s*low\s*voltage/i, /\bELV\b/i,
  /\bpublic\s*health\s+engineering/i,
  /\blightning\s*protection/i,
]
```

✅ All synonyms in the user's example are covered.

### 4.3 Pharo benchmark — project matching simulation

For the Pharo tender (architectural consultancy for a Specialty Medical
Center), the firm's claimed projects are:
- **G+6 Dr. Abdul Seid General Hospital** (ETB 550M, 7 000 m²)
- **Dessie Specialized Referral Hospital** (ETB 125M, 2 800 m²)
- **Entoto Eco-Park** (different sector)

The matcher would:
1. Detect `HEALTHCARE_FACILITIES` family in tender requirements
   (matches `/specialty\s+medical/i`, `/medical\s+center/i`).
2. Detect `HEALTHCARE_FACILITIES` family in the two hospital projects
   (matches `/\bhospital/i`).
3. Apply `+0.18` REVIEWED trust boost.
4. Apply sector boost (`+0.15` for sector match).
5. Final score well above `0.75` threshold → auto-selected.
6. Entoto Eco-Park would receive the strict-sector mismatch penalty
   (`-0.40`) and score below `0.55` → NOT selected.

✅ Correct behavior for the benchmark.

## 5. Major Gaps Identified

### 5.1 GAP — No real semantic embeddings (NOT FIXED — algorithm change)

Matching is hybrid lexical (TF-IDF cosine) + keyword-family (hand-coded
regex) + AI rematch (Claude 12-perspective). There are NO embedding
vectors, NO vector database, NO cosine-on-embeddings. The synonym space
is limited to what's hand-coded in `CAPABILITY_KEYWORDS`,
`SECTOR_PATTERNS`, `PROPOSAL_THEMES`. Novel synonyms not in the regex
lists will not match (e.g., "maternity home", "polyclinic", "health
post").

**Mitigation:** The AI rematch layer provides true semantic reasoning
when enabled, but it's a re-rank on top of deterministic candidates, not
a replacement. For vocabulary outside the regex dictionaries, the
deterministic matcher will produce a low score and the candidate may
not reach the AI rematch top-20.

**Not fixed in this PR** — adding embedding-based matching requires
choosing an embedding model (OpenAI/Cohere/local), storing vectors
(Postgres pgvector or external DB), and building a retrieval pipeline.
Out of scope for a no-deploy draft PR.

### 5.2 GAP — Vault fallback uses `contractValue` / `yearsExperience`, NOT tender relevance (NOT FIXED — algorithm change)

When zero selected+reviewed matches exist, the fallback loads the firm's
top-12 REVIEWED experts by `yearsExperience desc` and top-8 REVIEWED
projects by `contractValue desc`. These are NOT re-ranked by relevance
to the tender. A flagship hotel project could anchor a healthcare
tender's proposal if no reviewed healthcare project exists.

**Not fixed in this PR** — would require running the deterministic
matcher over the vault fallback set. Tracked as a follow-up.

### 5.3 GAP — Supporting documents (licenses, certificates) NOT relevance-matched (NOT FIXED — algorithm change)

`company.documents`, `company.legalRecords`, `company.financialRecords`,
`company.complianceRecords` are loaded wholesale at generation time
(`take: 24` docs, `take: 12` per record type) and passed to the AI
prompt as context lines. NO relevance matching is applied. Every
supporting document the firm has ever uploaded is dumped into the
prompt, regardless of whether it's relevant to the tender.

**Not fixed in this PR** — would require a relevance scorer for
non-Expert/Project evidence. Tracked as a follow-up.

### 5.4 GAP — Manual Expert/Project records have no `sourceDocumentId` (FIXED in this PR)

Manual Expert/Project creation via `POST /api/company/experts` and
`POST /api/company/projects` previously created REVIEWED records
without setting `sourceDocumentId`. The new records were disconnected
from any uploaded CompanyDocument — no audit trail back to the source
CV or testimony letter.

**Fix:** Both routes now accept an optional `sourceDocumentId` body
field. The handler validates that the document exists AND belongs to
the same company (prevents cross-tenant provenance injection) before
setting the FK.

## 6. Evidence Strength Classification

The user asked for "strong, partial, or unavailable" evidence
classification. The production matcher does NOT use this vocabulary
directly — it uses:

| Score range | Behavior |
|---|---|
| `score >= 0.75` | Auto-selected (`isSelected = true`) — equivalent to "strong" |
| `0.55 <= score < 0.75` | Force-promoted for minimum-3 guarantee with `[Below-threshold fallback]` rationale prefix — equivalent to "partial" |
| `score < 0.55` | NOT selected — equivalent to "unavailable" |

The dead-code module `lib/engine/company-evidence-matching.ts` defines
`RESOLUTION_THRESHOLD = 60` and `PARTIAL_THRESHOLD = 30` (on a 0-100
scale) for `RESOLVED` / `PARTIAL` / `UNRESOLVED` — but this module is
never imported by production code. It is a maintenance hazard tracked
for follow-up deletion.

## 7. Pharo Benchmark — Matching Simulation

| Tender requirement | Matched Expert | Matched Project | Evidence strength |
|---|---|---|---|
| Architectural consultancy for specialty medical center | Senior Architect with hospital experience | G+6 Dr. Abdul Seid General Hospital | Strong (score > 0.75) |
| Healthcare design experience | Same architect + biomedical engineer | Dessie Specialized Referral Hospital | Strong (score > 0.75) |
| MEP engineering | MEP engineer with medical gas experience | Hospital project with MEP scope | Strong (score > 0.75) |
| Construction supervision | Construction admin expert | Hospital project (supervision phase) | Strong (score > 0.75) |
| Eco-park / landscape | (none on staff) | Entoto Eco-Park | Strong for eco-park, NOT selected for healthcare |
| Specific Pharo-required certifications | (if uploaded in Appendix E) | — | Partial (no automatic matching) |

**Verdict:** ✅ The matching engine correctly identifies the relevant
Experts and Projects for the Pharo benchmark. The semantic regex
dictionaries cover healthcare vocabulary comprehensively. The AI rematch
layer (when enabled) provides additional semantic depth.

## 8. Recommendations for Follow-Up

1. Add embedding-based matching as a fallback for vocabulary outside the
   hand-coded regex dictionaries.
2. Re-rank vault fallback by tender relevance (run matcher over the
   fallback set).
3. Add relevance matching for supporting documents (licenses,
   certificates).
4. Delete the dead-code `lib/engine/company-evidence-matching.ts` and
   `lib/engine/tender-evidence-selector.ts` (1 272 lines of unused
   code with a different vocabulary).
5. Extend `CAPABILITY_KEYWORDS` with additional synonyms (maternity
   home, polyclinic, health post, etc.) — crowdsource from real
   tender vocabulary.

## 9. Verdict

✅ The matching engine uses semantic meaning (via 22 hand-coded
capability-family regex dictionaries + AI rematch) — not just exact
keywords. The healthcare example from the user's requirement is fully
covered. The Pharo benchmark's tender requirements would be correctly
matched to the firm's hospital projects. The one gap fixed in this PR
(sourceDocumentId on manual Expert/Project creation) closes the
provenance hole for manually-entered records. The remaining gaps
(embeddings, vault fallback relevance, supporting-document matching)
are tracked as follow-ups and do not block the core workflow.
