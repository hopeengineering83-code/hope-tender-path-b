# Golden-Tender Benchmark Rubric — 2026-07-04

Scoring contract for the PR E generation-quality harness. The harness runs the FULL app pipeline (upload → extract → AI Analyze → BuildPlan build+confirm → generate → validate → export ZIP) against fixed fixtures, scores the output, and writes `test-results/proposal-quality-report.json`. Two raw-prompt baselines (a ChatGPT-style single prompt and a Claude-style single prompt over the same tender text) are scored with the same rubric for comparison — the app must beat both on every hard dimension.

## Fixtures

| Fixture | Contents | Exercises |
|---|---|---|
| `fixtures/tenders/sample-technical-rfp/` | Multi-page RFP PDF (with `[Page N]` markers in extraction), exact file-naming instructions, mandatory requirements incl. bid-security original, technical/financial weights | full technical pipeline, official-original placeholders, page provenance |
| `fixtures/tenders/sample-eoi/` | Short EOI, no financial ask, no exact naming | minimal-plan path, cover letter, annex list |
| `fixtures/tenders/sample-financial-separated/` | RFP demanding separate technical + financial envelopes, price schedule template | pricing separation, two-envelope ZIP layout |
| `fixtures/company/haec-sample-library/` | Company profile, 6+ REVIEWED experts with CVs, 8+ REVIEWED projects with evidence, legal/financial records, letterhead asset | evidence density, named-entity usage, vault gates |

Fixtures are synthetic but realistic; nothing sector-hard-coded (no Pharo/pharma/NGO assumptions). Deterministic seeds; AI calls run against recorded fixtures or a live key behind `BENCHMARK_LIVE_AI=true`.

## Deliverables scored per fixture

Compliance matrix · technical proposal · financial proposal (where required) · cover letter (where required) · annex list · final ZIP package.

## Scoring dimensions

Hard dimensions FAIL the release when violated; soft dimensions score 0-100 and trend in the report.

| # | Dimension | Type | Measure | Threshold |
|---|---|---|---|---|
| 1 | Tender compliance coverage | HARD | % of extracted MANDATORY requirements addressed in the proposal + matrix (string-anchor + section mapping) | **≥ 95 %** |
| 2 | Unsupported factual claims | HARD | claims naming projects/experts/certifications not present in the vault fixture (NER cross-check against library) | **0** |
| 3 | Required sections missing | HARD | sections demanded by the tender's instructions absent from output | **0** |
| 4 | Exact section order | SOFT | Kendall-tau distance between demanded and produced section order | ≥ 90 |
| 5 | Evidence density | SOFT | named REVIEWED projects/experts with concrete attributes per 1 000 words | ≥ 3.0 |
| 6 | Named project/expert usage | SOFT | % of top-matched REVIEWED entities actually cited | ≥ 80 % |
| 7 | Generic-phrase index | SOFT | hits per 1 000 words from the banned-boilerplate lexicon ("world-class", "cutting-edge", "leave no stone unturned"…) | ≤ 1.0 |
| 8 | AI-trace phrases | HARD | "As an AI", "I cannot", "[INSERT", "TODO", "Lorem", chat markup, model self-reference — scanned on FINAL bytes (DOCX text layer), after all cleaners | **0** |
| 9 | Correct file naming | HARD | every ZIP entry matches the confirmed BuildPlan's `exactFileName` (case + extension exact) | **0 wrong names** |
| 10 | Page/word limits | HARD | tender-declared pageLimit/word caps respected per document | **0 violations** |
| 11 | Pricing separation | HARD | zero price/amount/rate tokens in technical envelope when separation demanded; financial content only in financial envelope | **0 leaks** |
| 12 | Export package match | HARD | ZIP manifest == confirmed BuildPlan items exactly (no extras, no missing, placeholders only for official-original items) | **0 mismatches** |
| 13 | Provenance integrity | HARD | every compliance-matrix row cites fileId+page+quote that passes `locateQuoteProvenPage` containment against fixture files | **0 fabricated citations** |
| 14 | Deterministic-fallback leakage | HARD | no deliverable in the ZIP carries `DETERMINISTIC_FALLBACK`/`PARTIAL_FALLBACK` provenance | **0** |

## Report format (`test-results/proposal-quality-report.json`)

```json
{
  "runAt": "<iso>", "sha": "<head sha>", "mode": "recorded|live",
  "fixtures": {
    "sample-technical-rfp": {
      "app":      { "hardFailures": [], "scores": { "coverage": 0.97, "sectionOrder": 94, "evidenceDensity": 4.1, "genericIndex": 0.4 } },
      "baselineChatGPT": { "hardFailures": ["coverage<0.95", "aiTraces>0"], "scores": { } },
      "baselineClaude":  { "hardFailures": ["unsupportedClaims>0"], "scores": { } }
    }
  },
  "releaseGate": { "pass": true, "failedDimensions": [] }
}
```

## Release rule

`releaseGate.pass = every fixture's app output has zero HARD failures`. Any HARD failure blocks release (PR H gate consumes this file). Baselines are informational but the app failing a dimension a raw baseline passes is treated as a regression to investigate before release.

## Anti-gaming rules

- Scans run on the FINAL exported bytes (DOCX text layer, ZIP entries) — never on intermediate markdown, so post-cleaners cannot hide traces (the `cleanLine`-strips-fallback-markers bug class).
- The banned-lexicon and AI-trace lists live in the harness, not in app code, so the generator cannot special-case them.
- Fixture vault is the ONLY evidence universe: any named entity outside it counts as an unsupported claim.
- Thresholds may only be tightened, never loosened, without a documented decision in this file's history.
