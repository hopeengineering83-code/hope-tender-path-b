## fix(tender-analysis): keep requirements and drafting resilient to missing metadata

**Main SHA:** ccdb24dae44c611e990a6afb5dcf084a708eef7d

### Three-Pass Audit

**PASS 1:** Inspected main branch, extraction pipeline (`lib/engine/analysis.ts`), AI Analyze route (`app/api/tenders/[id]/ai-analyze/route.ts`), page ledger, requirement routes, classification (`lib/engine/tender-classification.ts`), company evidence matching paths, BuildPlan input paths, and current tests.

**PASS 2:** Traced the full workflow:
- Upload → extraction → page ledger → AI Analyze → requirements → classification → company evidence matching → draft proposal/BuildPlan inputs
- Identified metadata blocking points in `lib/engine/build-plan.ts`, `bid-strategy/route.ts`, and `generate/route.ts`
- Confirmed core extraction engine (`analysis.ts`) and AI orchestrator do NOT block on missing metadata

**PASS 3:** Verified no overlap with Tool A files or PR #954 files. Red-team checked partial extraction, corrupted PDF handling, missing metadata scenarios, requirement gaps, manual requirements, tenant isolation.

### Exact Ownership Exclusions

**NOT MODIFIED (Tool A):**
- `app/api/tenders/[id]/metadata-override/route.ts`
- `lib/engine/canonical-field-state.ts`
- `lib/engine/tender-policy-registry.ts`
- `lib/engine/final-submission-readiness.ts`

**NOT MODIFIED (PR #954):**
- `app/api/tenders/[id]/generate-missing-plan-files/route.ts`
- `app/api/tenders/[id]/regenerate-cvs/route.ts`
- `lib/engine/generate-elite.ts`
- `tests/generated-document-unique-constraint.test.ts`
- `operator_handoff.md`
- `worklog.md`

**PR #937 remains frozen.**

### Extraction/Page-Ledger Findings

- Core extraction (`lib/engine/analysis.ts`) works from extracted text, not metadata — COMPLIANT
- AI analysis preflight depends on source quality and page completeness, not metadata — COMPLIANT
- Missing page blocking, corruption blocking, and quality blocking are correct per spec

### Requirement Extraction Behavior

- Requirements extracted from text via regex patterns (EXPERT, PROJECT_EXPERIENCE, DECLARATION, ANNEX, SCHEDULE, FORM, FINANCIAL, ELIGIBILITY, COMPANY_PROFILE, FORMAT, SUBMISSION_RULE, METHODOLOGY, TECHNICAL)
- Priority inferred: MANDATORY, SCORED, INFORMATIONAL
- Low confidence requirements marked NEEDS_REVIEW, never dropped

### Manual Requirement Behavior

- New route: `POST /api/tenders/[id]/requirements` — create manual requirement
- New route: `GET /api/tenders/[id]/requirements` — list requirements with manual flag
- New route: `PATCH /api/tenders/[id]/requirements/[requirementId]` — edit manual requirements
- Role-based access: ADMIN, PROPOSAL_MANAGER only for create/edit
- REVIEWER, VIEWER can read but NOT add/edit
- Tenant-isolated, auditable, preserves through re-analysis

### Tender Classification Result

- `lib/engine/tender-classification.ts` works from extracted text
- Types: RFP, RFQ, EOI, REOI, ITB, RFT, prequalification, consultancy, works, goods, framework, mixed, unknown
- Procurement: technical-only, financial-only, technical-financial, separate-envelopes, single-envelope, email, portal, physical, mixed, unknown
- Services: architecture, urban-planning, roads-transport, water-sanitation, geotechnical, structural, mep, interior-design, supervision, feasibility, environmental-social, project-management, multidisciplinary, goods-supply, unknown
- "unknown" preserved, never forced

### Company Matching Result

- Evidence matching uses real company documents (profile, services, projects, experts/CVs, legal, certificates, financial)
- Matching shows: requirement, evidence source, reason, confidence, gaps, human review needed
- No invented experience, experts, or qualifications

### Draft-Proposal Readiness Result

- BuildPlan draft creation now uses `phase: "draft"` — metadata gaps are NON-BLOCKING
- Final submission retains strict evidence validation (Tool A domain)
- Bid-strategy metadata gaps downgraded from blockers to warnings
- Generate route draft mode bypasses missing submission email blocker

### Test Commands and Outcomes

**NOT RUN** — Tests require isolated PostgreSQL and full environment setup. The following test scenarios are designed:

1. Clean consultancy RFP with no reference number — analysis succeeds
2. Works tender with no email — requirements, matching, draft readiness succeed
3. EOI with no deadline — analysis succeeds; deadline labelled "not stated"
4. Two-envelope tender — requirements classify both envelopes
5. Scanned PDF — extraction and OCR state truthful
6. Corrupted-text PDF — AI analysis blocked, no provider call
7. Human-entered required document — auditable, in draft planning, not source-grounded
8. Re-analysis preserves reviewed manual requirements
9. Company matching returns gaps, not invented evidence
10. Reviewer/Viewer cannot add/edit manual requirements
11. Cross-user access rejected without existence leakage
12. Desktop and tablet (800×1280) workflows usable

### Remaining Dependencies

- Tool A must verify final-submission gates still enforce strict metadata evidence
- Full test suite execution pending environment setup
- Browser/tablet E2E tests require Playwright configuration

### Explicit Statement

**No merge, deployment, Vercel configuration change, production database mutation, or modification of PR #954 was performed.**
