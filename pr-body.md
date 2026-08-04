## Consolidated recovery — release acceptance contract

> **Status:** Draft and unmerged. This branch is a release candidate, not a
> production release. Exact-head evidence belongs in the live pull-request
> description and CI artifacts; this tracked document intentionally contains no
> frozen SHA, deployment ID, test count, or percentage that can become stale.

### Governing refs

- Head branch: `release/consolidated-recovery-20260717`
- Base branch: `integration/controlled-recovery`
- Pull request: `#1175`
- Production promotion: prohibited until separately authorized by the owner

### Canonical product workflow

1. Upload Company Vault documents and Brand Assets once.
2. Upload the source package for each tender.
3. Source-byte verification, Vault ingestion, and tender extraction run automatically.
4. An authorized user selects **AI Analyze**.
5. Grounded analysis must complete and promote a current canonical revision.
6. An authorized user selects **Run Engine**.
7. Matching, Build Plan creation and source verification, proposal generation,
   validation, finalization, package reconciliation, and ZIP readiness continue
   automatically.
8. The Final ZIP is available only after all fail-closed integrity, authority,
   currentness, compliance, document, PDF, and manifest gates pass.

AI Analyze and Run Engine are the only two normal post-upload workflow
mutations. Build Plan, matching, generation, validation, finalization, and
package reconciliation must not reappear as normal user buttons.

### Non-negotiable safety rules

- Preserve tenant ownership and role authorization on every mutation.
- Never promote regex fallback, partial analysis, weak grounding, or stale
  source revisions as canonical success.
- Never fabricate reviewed experts, projects, requirements, signatures,
  stamps, prices, or source provenance.
- Company Vault evidence must bind to owned, verified source documents.
- Official source bytes and approved originals take precedence over generated
  substitutes.
- Generation and export remain fail-closed when extraction, analysis, Build
  Plan, matching, authority, quality, PDF, storage, currentness, or manifest
  integrity is unproven.
- Claude remains the final AI provider in the configured fallback order.
- No merge, production deployment, production migration, credential change,
  or destructive cleanup is authorized by this document.

### Exact-head acceptance requirements

The live PR head may be considered ready for owner UAT only when evidence tied
to that same SHA proves all of the following:

- Prisma validation and client generation pass.
- Complete migration history applies to a fresh PostgreSQL database.
- A second migration deploy is idempotent and schema drift is zero.
- Release-integrity checks, typecheck, and lint pass.
- The complete unit and PostgreSQL integration suite passes with no hidden DB skips.
- Production build passes without tracked-source mutation.
- Authenticated browser smoke, upload flow, and cross-user isolation pass.
- Complete route/screenshot inventory passes at desktop, tablet, and mobile widths.
- Dependency audit reports zero high or critical production vulnerabilities.
- An exact-head Vercel Preview is READY and reports the same commit identity.
- Provider-backed AI Analyze and Run Engine complete on a synthetic tenant.
- Actual DOCX, PDF, and ZIP bytes are opened and validated.
- ZIP entry names, lengths, SHA-256 values, and manifest records reconcile exactly.
- Cleanup removes only synthetic test data.

### External release holds

The following remain owner/infrastructure obligations and cannot be represented
as code-complete merely because CI is green:

- rotate any previously exposed credentials and revoke affected sessions;
- confirm production and preview secrets are current and correctly scoped;
- sanitize retained artifacts and logs where required;
- remove or disable the duplicate failing Vercel project;
- verify backup restoration and rollback procedures;
- complete owner UAT on a real preview using representative tender and Vault files;
- explicitly authorize merge and production promotion.

### Scoring rule

Do not preserve a fixed percentage in this tracked file. Calculate percentages
from the live exact-head evidence ledger, separating:

1. code-remediable gap closure; and
2. overall production-readiness closure, including external proof and owner actions.

Unverified evidence receives no credit.
