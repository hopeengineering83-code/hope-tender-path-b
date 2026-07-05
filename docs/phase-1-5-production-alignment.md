# Phase 1.5 Production Alignment

This upgrade pass focuses on closing the most important remaining gaps between the current application and the original Hope Tender Proposal Generator brief.

## Included in this pass

### 1. Stricter validation enforcement
The validation engine has been hardened so that these issues now block finalization instead of appearing only as warnings:

- unresolved mandatory requirements
- missing tender-required files
- extra generated files outside tender naming scope
- file count mismatches
- file order mismatches
- expert quantity mismatches
- project reference quantity mismatches
- generated files missing exact file names

This aligns the validation path more closely with the original instruction that the system must generate exactly and only what the tender requires.

### 2. Expanded Prisma domain model
The Prisma schema has been extended with the missing first-class domain models that were called out in the original product prompt:

- `Role`
- `ProjectEvidence`
- `LegalRecord`
- `FinancialRecord`
- `CompanyComplianceRecord`
- `ComplianceMatrix`

This improves the architecture for evidence-backed compliance mapping, company records management, and future auditability.

## Remaining production cutover work

### PostgreSQL migration hygiene
The target and current production posture is PostgreSQL with Prisma. Continue enforcing migration-safe operation:

1. Keep Prisma datasource and runtime configuration aligned to PostgreSQL.
2. Regenerate Prisma client after schema changes.
3. Create and apply migration files via Prisma workflows.
4. Keep `DATABASE_URL` configured for production and CI environments.
5. Smoke test authentication, tender intake, generation, validation, and export after each schema migration.

### Runtime bootstrap alignment
Runtime bootstrap behavior must remain Prisma/PostgreSQL compatible. Any legacy SQLite bootstrap paths should be treated as historical/development-only and must not contradict production deployment guidance.

## Recommended next step

The next clean milestone should be **Production hardening follow-up**, focused on export/generation strictness, official-form replacement gating, and deeper extraction reliability under PostgreSQL/Prisma production assumptions.
