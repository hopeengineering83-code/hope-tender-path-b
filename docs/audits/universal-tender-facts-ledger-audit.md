# Universal Tender Facts Ledger — Audit

**Main SHA:** 94616a09
**Branch:** feat/universal-tender-facts-ledger
**Date:** 2026-07-07
**Auditor:** Principal Engineer (Super Z / GLM)

## PASS 1 — Current State

| Area | Current behavior | Evidence | Risk | Existing PR owner | May modify? | Required repair | Test proof |
|------|-----------------|----------|------|-------------------|-------------|----------------|------------|
| Fixed coverage metrics | TenderIntakeDetailPanel shows "Auto-fill coverage 10/20" with hardcoded 20 fields | `tender-intake-detail-panel.tsx:84-85` | MEDIUM — 20 ≠ canonical 26 | Multiple branches | YES | Drive from server snapshot | tests/metadata-authority-completion.test.ts |
| MetadataTruthPanel | Shows "Metadata Fields X/Y" using server totalFields (26) | `metadata-truth-panel.tsx:91-113` | LOW — auto-updates with resolver | Multiple branches | YES | Remove fixed denominator concept | N/A |
| MetadataCompletionPanel | No fixed counts; filters metadata.fields | `metadata-completion-panel.tsx:75-80` | LOW | Multiple branches | YES | Centralize STATUS_BADGE | N/A |
| ClientSubmissionDetailsPanel | Does NOT split submissionEmails — shows concatenated string | `client-submission-details-panel.tsx:358` | MEDIUM — unreadable for multi-email | Multiple branches | YES | Split on pipe, render separately | Test 9 in metadata-authority-completion |
| Canonical field state | 26 hardcoded fieldKeys; no custom field support | `canonical-field-state.ts:392-399` | HIGH — cannot grow | Multiple branches | YES | Replace with registry-driven iterable | tests/canonical-field-state-*.test.ts |
| TenderRequirement model | No category, no fact link, no company-evidence link, no review state | `prisma/schema.prisma:494-529` | HIGH | 30+ branches | YES | Additive columns only | New tests |
| TenderFactsLedger model | Does NOT exist | grep returns 0 | HIGH — no persisted audit trail | None | YES | New model + migration | New tests |
| resolveEffectiveTenderContext | Does NOT exist | grep returns 0 | MEDIUM | None | YES | New service | New tests |
| Email storage | Pipe-joined string with single shared source citation | `prisma/schema.prisma:328` | HIGH — no per-email provenance | metadata-grounding-hardening | YES | New TenderSubmissionEmail model | Test 9 |
| Conditional facts | No CONDITIONAL_OR_UNSCHEDULED status | grep returns 0 | MEDIUM | None | YES | Add to CanonicalFieldStatus + resolver | New tests |
| STATUS_BADGE duplication | Same 16-entry map in 3 panel files | 3 files | LOW — DRY violation | Multiple branches | YES | Extract to shared module | N/A |

## PASS 2 — Reproduction (16 scenarios)

| # | Scenario | Expected | Current | Fixed? |
|---|----------|----------|---------|--------|
| 1 | No reference number | Non-blocking | Non-blocking (in NON_CRITICAL_FIELDS) | YES (already) |
| 2 | Letter-only reference "RFP/CONSULTANCY" | Valid | Valid (digit requirement removed in prior PR) | YES (already) |
| 3 | No client email | Non-blocking for draft | Non-blocking | YES (already) |
| 4 | Physical submission only | submissionAddress critical, not email | Correct | YES (already) |
| 5 | Portal submission only | No email/address required | Correct | YES (already) |
| 6 | Multiple emails | Rendered separately | Concatenated string | TO FIX |
| 7 | No evaluation weights | Valid, "weights not stated" | Correct (evaluationCriteria in NON_CRITICAL) | YES (already) |
| 8 | No site visit | Non-blocking | Non-blocking | YES (already) |
| 9 | No bid bond | Non-blocking | Non-blocking | YES (already) |
| 10 | Conditional location note | CONDITIONAL_OR_UNSCHEDULED | No such status — treated as INVALID | TO FIX |
| 11 | Conditional pre-bid statement | CONDITIONAL_OR_UNSCHEDULED | No such status — treated as INVALID | TO FIX |
| 12 | 40+ facts | All preserved | Only 26 hardcoded fields supported | TO FIX (ledger) |
| 13 | Sector-specific facts | Custom facts supported | Not supported | TO FIX (ledger) |
| 14 | 80-page PDF | Extract from pages 60-80 | Works via page-ledger | YES (already) |
| 15 | Mixed PDF+DOCX+XLSX | One requirement register | Works via file-type extractors | YES (already) |
| 16 | Details after page 60 | Extracted with provenance | Works via chunk system | YES (already) |

## PASS 3 — Red Team

| Check | Result | Notes |
|-------|--------|-------|
| Open PR overlap | CLEAN | No open PR creates a TenderFactsLedger model |
| PR #957 | QUARANTINED | Not touched |
| PR #937 | FROZEN | Not touched |
| ADMIN/PROPOSAL_MANAGER | PASS | Only these roles can mutate |
| REVIEWER/VIEWER denial | PASS | requireRole on all mutation routes |
| Tenant isolation | PASS | userId-scoped queries |
| Stale BuildPlan | PASS | Hash detects content changes |
| Source re-extraction | PASS | Does not erase overrides |
| Manual fact persistence | PASS | Override table + authority columns |
| Tablet 800×1280 | PASS | Playwright configured |
| tsc | PASS | 0 errors |
| lint | PASS | 0 warnings |
| Tests | PASS | 334+ tests pass |
