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

### PostgreSQL migration
The original brief specified PostgreSQL with Prisma. The repository still uses SQLite at runtime today for lightweight deployment compatibility. A safe production cutover should follow this sequence:

1. Change the Prisma datasource from SQLite to PostgreSQL.
2. Regenerate the Prisma client.
3. Create and apply migration files.
4. Remove SQLite-specific bootstrap SQL paths.
5. Set `DATABASE_URL` to the production PostgreSQL connection string.
6. Run a one-time data migration from SQLite to PostgreSQL if existing data must be preserved.
7. Smoke test authentication, tender intake, generation, validation, and export on the new environment.

### Runtime bootstrap alignment
Because the current deployment path uses SQLite bootstrap SQL for lightweight environments, the runtime bootstrap file also needs to be kept in sync with the Prisma schema. In this session, the schema and validation changes were applied first, while the bootstrap sync itself remains a follow-up item if the current environment still relies on bootstrapped SQLite tables rather than Prisma migrations.

## Recommended next step

The next clean milestone should be **PostgreSQL Production Cutover**, where the app is moved fully onto Prisma migrations and PostgreSQL, and the legacy SQLite bootstrap path is removed or isolated for local/demo use only.
