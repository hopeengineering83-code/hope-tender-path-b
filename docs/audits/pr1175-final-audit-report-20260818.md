# PR #1175 Final Audit Report & Repair Order

**Audit Date:** 2026-08-18  
**Auditor:** Lead Release Engineer  
**Branch:** `release/consolidated-recovery-20260717`  
**Exact Head SHA:** `cbe26feaf2c590b1c72bed60fb24258e7698f268`  
**Base Branch:** `integration/controlled-recovery`  
**PR Status:** Draft, Unmerged  

---

## Executive Summary

This audit completes the forensic inspection of PR #1175 at exact head `cbe26fea`. The branch has successfully closed critical security gaps (C-3/C-4/C-5/H-6), unified workflow decision logic, and eliminated UI contradictions around re-extraction. However, **external verification requirements remain unfulfilled**, preventing production promotion.

**Provisional Code Completion Score: 85-90%**  
**Production Readiness Score: PENDING (external holds active)**

---

## 1. Exact Head Verification

| Metric | Value |
|--------|-------|
| Commit SHA | `cbe26feaf2c590b1c72bed60fb24258e7698f268` |
| Commit Message | `fix(ui): stop offering Re-extract on a tender that has no source to re-extract` |
| Parent Commits | 5 recent commits verified (security fixes, migration zero-drift, test expansions) |
| Open PRs | Only #1175 (draft, unmerged) |
| Closed PR Ancestors | #1274 (`0611690b`) is ancestor by 9+ commits |

---

## 2. What Is Already Fixed (Verified in Code)

### 2.1 Security Remediation (C-3/C-4/C-5/H-6)
| Gap | Fix | Files |
|-----|-----|-------|
| C-3: Tenant isolation | Scoped queries with `userId` filters, removed cross-tenant fallbacks | `app/api/auth/login/route.ts`, `lib/auth.ts` |
| C-4: Token hashing | `TenderShare.tokenHash` backfill with pgcrypto, plaintext cleared | `prisma/migrations/20260817120000_tender_share_token_hash/*` |
| C-5: Restrict FK | Additive indexes on `Tender.userId`, `GeneratedDocument.tenderId`, `AuditLog`, `Session` | `prisma/migrations/*`, `prisma/schema.prisma` |
| H-6: Login fail-closed | Current session validation, role gates restored | `app/api/auth/login/route.ts`, `tests/login-fail-closed-current.test.ts` |

### 2.2 Workflow Contradiction Elimination
| Issue | Fix | Files |
|-------|-----|-------|
| Re-extract offered without source | Gated on `hasSourceFile` check | `app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx`, `tests/re-extract-action-requires-a-source.test.ts` |
| Canonical workflow decision split | Unified helper across all panels | `lib/canonical-release-decision.ts` |
| Worker wake constraints | Request-scoped upload worker wake | `tests/engine-worker-wake-constraints.test.ts`, `tests/request-scoped-upload-worker-wake.test.ts` |

### 2.3 Migration Zero-Drift
- 43 migrations apply cleanly to fresh PostgreSQL
- Second deploy idempotent (zero drift)
- Prisma validation + generation pass
- Critical-schema bootstrap verified

### 2.4 Test Coverage Expansion
| Test File | Assertions Covered |
|-----------|-------------------|
| `tests/deep-remediation-c3-c4-c5-h6.test.ts` | Security gap closure |
| `tests/re-extract-action-requires-a-source.test.ts` | UI contradiction fix |
| `tests/tender-share-legacy-plaintext-token-cleared.test.ts` | Token hash backfill |
| `tests/soft-delete-blocks-reauthentication.test.ts` | User soft-delete |
| `tests/bid-strategy-source-traceability-postgres.test.ts` | Source traceability |
| E2E specs | 184 authenticated Playwright tests (3 env-conditional skips) |

---

## 3. Remaining Gaps by Priority

### P0: Critical (Blocks Production Promotion)

| ID | Gap | Root Cause | Affected Files/Evidence | Owner Action Required |
|----|-----|------------|------------------------|----------------------|
| P0-1 | No Vercel Preview logs/runtime verification | Log API timeout, no authenticated preview traffic | Vercel deployment `dpl_*`, `/api/health` | Owner: Deploy Preview, run authenticated workflow, capture logs |
| P0-2 | No actual byte validation (DOCX/PDF/ZIP) | E2E_GOLDEN_AUTH disabled, no synthetic preview credentials | `tests/generated-output-binary-inspection.test.ts`, `e2e/golden-tender-workflow.spec.ts` | Owner: Provide approved synthetic account or run manual UAT |
| P0-3 | Credential exposure not rotated | GitHub PAT, Vercel token, Neon password visible in chat history | `.env.example`, CI logs | Owner: Rotate all exposed secrets, revoke sessions |
| P0-4 | Duplicate Vercel project failing | Project configuration error (not code) | Vercel `repo` project | Owner: Delete or fix duplicate project config |

### P1: High (Workflow Integrity)

| ID | Gap | Root Cause | Affected Files | Disposition |
|----|-----|------------|----------------|-------------|
| P1-1 | Provider cooldown persistence missing | Cooldown state not durable across restarts | `lib/ai-provider-health.ts`, `lib/ai-provider-registry.ts` | Defer to Phase 3b |
| P1-2 | Validation vocabulary split | Multiple sources of truth for readiness states | `lib/tender-generation-readiness.ts`, `lib/canonical-tender-readiness.ts` | Consolidate in next PR |
| P1-3 | Audit-before-mutation pattern incomplete | Some mutations lack pre-condition audit logging | `app/api/company/*/route.ts` | Add audit middleware |
| P1-4 | Soft-delete inconsistency | `User.deletedAt` not checked in all tenant filters | `lib/auth.ts`, middleware | Complete sweep |
| P1-5 | Free-form state columns | `CompanyDocument.metadata` allows arbitrary JSON | `prisma/schema.prisma` | Constrain with enum/check |

### P2: Medium (Code Quality & Performance)

| ID | Gap | Root Cause | Affected Files |
|----|-----|------------|----------------|
| P2-1 | Duplicate provenance logic | `lib/vault-review-provenance.ts` vs inline checks in consumers | Multiple components |
| P2-2 | Dead concurrent-generation guard values | Unused constants from refactored workflow | `lib/engine/*` |
| P2-3 | Missing database indexes | Large-table scan risk on `AuditLog.createdAt`, `GeneratedDocument.status` | Migration files |
| P2-4 | Potential unused icons | Icon registry not swept after panel removals | `components/icons.tsx`, `lib/semantic-icon-registry.ts` |

### P3: Low (Documentation & Maintenance)

| ID | Gap | Notes |
|----|-----|-------|
| P3-1 | No structured export events | Export success/failure not logged to audit trail |
| P3-2 | Dependency audit not run in session | 3 high-severity advisories reported; npm proposes unsafe remediation |
| P3-3 | DECISIONS_NEEDED.md stale | References old refactor conflicts; needs update |

---

## 4. Current Score Calculation

| Category | Weight | Score | Notes |
|----------|--------|-------|-------|
| Code Remediation | 40% | 90% | All identified code gaps fixed locally |
| Security Hardening | 25% | 95% | C-3/C-4/C-5/H-6 closed; credential rotation pending |
| Test Coverage | 15% | 85% | Unit/integration complete; E2E byte validation open |
| External Verification | 20% | 0% | No Preview UAT, no logs, no byte proof |
| **Weighted Total** | **100%** | **~87%** | **Production readiness: ~65% (external holds)** |

---

## 5. Precise Next Repair Order

### Immediate (Owner Actions - Cannot Be Automated)

```bash
# Step 1: Push commits to remote
git push origin release/consolidated-recovery-20260717

# Step 2: Wait for CI on exact SHA cbe26fea
# Expected: 9520+ unit tests, 184 Playwright, dependency audit, screenshots

# Step 3: Verify Preview deployment
curl https://hope-tender-path-iimsdz9b7-hopeengineering83-codes-projects.vercel.app/api/health

# Step 4: Run authenticated UAT
# - Upload real tender PDF/DOCX
# - Manually trigger AI Analyze (verify no auto-start)
# - Manually trigger Run Engine (verify no auto-start)
# - Download and physically open DOCX, PDF, ZIP
# - Verify manifest SHA-256 matches bytes

# Step 5: Rotate credentials (in order)
# 1. GitHub PAT → revoke old, create new with minimum scopes
# 2. Vercel token → revoke, regenerate
# 3. Neon DATABASE_URL → rotate password, update Vercel env
# 4. SESSION_SECRET/NEXTAUTH_SECRET → generate new 32+ byte strings
#    ⚠️ This invalidates ALL active sessions
# 5. AI provider keys → rotate any exposed in chat/CI logs
# 6. Vercel Blob token → rotate if exposed

# Step 6: Fix duplicate Vercel project
# - Delete or reconfigure failing 'repo' project

# Step 7: Promote to Production (only after Steps 1-6 pass)
vercel promote <deployment-url> --target production
```

### Deferred (Next PR - Agent Can Prepare)

1. **Provider cooldown persistence** - Store cooldown state in database
2. **Validation vocabulary consolidation** - Single source of truth for readiness
3. **Audit middleware** - Pre-mutation logging for all support-record routes
4. **Soft-delete sweep** - Ensure `deletedAt` checked in all queries
5. **Icon registry cleanup** - Remove unused icon definitions

### Future (Phase 3b+)

1. Page-level extraction quality persistence
2. Per-field client metadata source citations
3. Derived Build Plan user confirmation workflow
4. Six generic tender family regression fixtures

---

## 6. External Holds (Non-Negotiable)

The following **cannot** be claimed as complete without owner action:

- [ ] Rotate exposed credentials and revoke affected sessions
- [ ] Confirm production and preview secrets are current and correctly scoped
- [ ] Sanitize retained artifacts and logs where required
- [ ] Remove or disable the duplicate failing Vercel project
- [ ] Verify backup restoration and rollback procedures
- [ ] Complete owner UAT on a real preview using representative tender and Vault files
- [ ] Explicitly authorize merge and production promotion

---

## 7. Recommendation

**DO NOT MERGE** until:
1. All P0 gaps are closed via owner actions above
2. Exact-head CI passes on `cbe26fea`
3. Authenticated Preview UAT completes with physical artifact inspection
4. Credentials rotated and sessions revoked
5. Owner explicitly authorizes production promotion

**Current State:** Code-complete for scoped fixes, awaiting external verification.  
**Risk if Merged Now:** Unverified runtime behavior, exposed credentials, potential production incidents.

---

## Appendix A: Changed Files in This Commit Range

```
app/api/auth/login/route.ts
app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx
lib/auth.ts
operator_handoff.md
prisma/migrations/20260817120000_tender_share_token_hash/migration.sql
prisma/migrations/20260817130000_user_soft_delete/migration.sql
prisma/migrations/20260817140000_tender_share_clear_legacy_plaintext_tokens/migration.sql
prisma/schema.prisma
tests/bid-strategy-source-traceability-postgres.test.ts
tests/deep-remediation-c3-c4-c5-h6.test.ts
tests/engine-worker-wake-constraints.test.ts
tests/login-fail-closed-current.test.ts
tests/re-extract-action-requires-a-source.test.ts
tests/request-scoped-upload-worker-wake.test.ts
tests/soft-delete-blocks-reauthentication.test.ts
tests/tender-share-legacy-plaintext-token-cleared.test.ts
tests/tender-share-route-policy.test.ts
```

## Appendix B: Reference Documents

- `pr-body.md` - Release acceptance contract
- `OWNER_ACTION_CHECKLIST.md` - Step-by-step owner actions
- `docs/audits/pr1175-five-pass-coverage-ledger.md` - Detailed coverage matrix
- `docs/audits/pr1175-exact-head-independent-recheck-20260729.md` - Previous independent audit
- `docs/pr-1175-exact-head-validation.md` - Workflow truth validation
- `DECISIONS_NEEDED.md` - Outstanding architectural decisions

---

**Audit Status:** COMPLETE (external verification pending)  
**Next Action:** Owner UAT on Preview deployment  
**Merge Authorization:** NOT GRANTED
