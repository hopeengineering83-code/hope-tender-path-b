# Engine Integration Tests

**Branch:** `fix/exhaustive-current-gap-cleanup`
**Addresses audit gap:** GAP-TEST-01

## Purpose

This directory will house golden-corpus integration tests for the tender
engine. Currently it contains only scaffolding; the actual golden-corpus
tests will be added in a follow-up PR.

## Intended pattern

Each integration test should:

1. **Load a known tender fixture** from `tests/fixtures/golden-corpus/`
   (a real tender PDF + a known expected-output JSON).
2. **Run the full engine pipeline** against the fixture:
   - Text extraction (`lib/extract-text.ts`)
   - Metadata inference (`lib/engine/tender-metadata.ts`)
   - AI Analyze (`lib/engine/analysis.ts`) — with mocked AI provider
   - Requirement extraction (`lib/engine/stable-requirements.ts`)
   - Matching (`lib/engine/matching.ts`)
   - Compliance matrix (`lib/engine/compliance-matrix-builder.ts`)
   - Build Plan (`lib/engine/build-plan.ts`)
   - Generation (`lib/engine/generate-elite.ts`)
   - Validation (`lib/engine/validate.ts`)
   - Export readiness (`lib/engine/export-readiness.ts`)
   - Final ZIP assembly (`lib/engine/final-zip-assembly.ts`)
3. **Snapshot the resulting `GeneratedDocument` set** — filename, documentType,
   byte size, content summary, validation status, review status.
4. **Re-run on every PR** — snapshot drift fails the test, alerting the team
   to unintended changes in engine output.

## Why this matters

The current test suite has 514 test files covering contract-level behavior
(route handlers, individual modules, source-text invariants). What it lacks
is end-to-end engine integration coverage — verifying that the full pipeline
produces the expected output for a known input.

The single existing test (`tests/engine/tender-regression.test.ts`) covers
lifecycle state transitions but not full-pipeline output.

## Fixtures needed

The following golden-corpus fixtures are needed (to be added in a follow-up
PR):

| Fixture ID | Tender type | Pages | Source |
|---|---|---|---|
| `golden-corpus/consultancy-rfp-01/` | Consultancy RFP (World Bank-style) | 24 | Anonymized real tender |
| `golden-corpus/construction-road-01/` | Construction (AfDB-style road rehab) | 67 | Anonymized real tender |
| `golden-corpus/donor-ngo-01/` | Donor/NGO (UNDP-style capacity building) | 38 | Anonymized real tender |
| `golden-corpus/engineering-supply-01/` | Engineering supply (plant hire) | 18 | Anonymized real tender |

Each fixture directory should contain:

- `tender.pdf` — the tender document
- `expected-metadata.json` — expected extracted metadata
- `expected-requirements.json` — expected extracted requirements
- `expected-build-plan.json` — expected build plan
- `expected-documents-manifest.json` — expected generated document list
- `vault.json` — controlled Company Vault data (experts + projects)
- `README.md` — provenance and licensing

## Implementation status

| Item | Status |
|---|---|
| Directory created | Done (this PR) |
| Pattern documented | Done (this README) |
| Fixtures assembled | Not started (follow-up PR) |
| Test runner implemented | Not started (follow-up PR) |
| CI integration | Not started (follow-up PR) |

This scaffolding establishes the intended pattern so future contributors
can extend it consistently.
