# PASS 1: Complete Repository Inventory

**Branch:** `fix/exhaustive-current-gap-cleanup` (based on `main` @ `e8c71487`)
**Generated:** 2026-07-15
**Method:** `git ls-files` + per-file classification

## Summary

- **Total tracked files:** 1474
- **Reviewed files (runtime + test + config + migration + documentation):** 1418
- **Excluded files (vendor/generated/N/A):** 56

## Classification breakdown

| Category | Count | Percentage |
|---|---:|---:|
| REVIEWED_RUNTIME | 704 | 47.8% |
| REVIEWED_TEST | 555 | 37.7% |
| REVIEWED_DOCUMENTATION | 89 | 6.0% |
| NOT_APPLICABLE_WITH_REASON | 54 | 3.7% |
| REVIEWED_MIGRATION | 39 | 2.6% |
| REVIEWED_CONFIG | 31 | 2.1% |
| GENERATED_OR_VENDOR | 2 | 0.1% |
| **TOTAL** | **1474** | **100.0%** |

## Files by extension (top 20)

| Extension | Count |
|---|---:|
| `.ts` | 1049 |
| `.tsx` | 149 |
| `.md` | 125 |
| `.py` | 47 |
| `.sql` | 38 |
| `.mjs` | 22 |
| `.json` | 14 |
| `.yml` | 10 |
| `(none)` | 7 |
| `.js` | 3 |
| `.sh` | 2 |
| `.example` | 1 |
| `.css` | 1 |
| `.lock` | 1 |
| `.plugin` | 1 |
| `.cjs` | 1 |
| `.cts` | 1 |
| `.toml` | 1 |
| `.prisma` | 1 |

## Large files (>= 500 lines)

**Total files >= 500 lines:** 93
**Total files >= 1,000 lines:** 17
**Total files >= 2,000 lines:** 6

### Files >= 2,000 lines (refactor candidates)

| File | Lines | Size (KB) |
|---|---:|---:|
| `package-lock.json` | 9,292 | 314.4 |
| `lib/ai.ts` | 4,418 | 262.8 |
| `app/dashboard/tenders/[id]/tender-detail.tsx` | 3,659 | 197.3 |
| `lib/engine/generate-elite.ts` | 3,510 | 193.5 |
| `worklog.md` | 2,637 | 145.8 |
| `app/api/tenders/[id]/ai-analyze/route.ts` | 2,052 | 100.5 |

### Files 1,000 - 1,999 lines

| File | Lines | Size (KB) |
|---|---:|---:|
| `lib/extract-text.ts` | 1,552 | 73.8 |
| `lib/engine/proposal-intelligence.ts` | 1,526 | 115.4 |
| `lib/prisma.ts` | 1,440 | 69.9 |
| `lib/engine/proposal-sections.ts` | 1,406 | 102.4 |
| `lib/engine/final-submission-readiness.ts` | 1,253 | 61.8 |
| `lib/engine/tender-lifecycle-orchestrator.ts` | 1,133 | 50.8 |
| `prisma/migrations/20260601000000_init/migration.sql` | 1,125 | 37.5 |
| `lib/engine/tender-facts-ledger-service.ts` | 1,114 | 36.9 |
| `app/api/tenders/[id]/generate/route.ts` | 1,111 | 78.3 |
| `app/dashboard/company/page.tsx` | 1,049 | 71.8 |
| `lib/engine/benchmark-tables.ts` | 1,000 | 64.8 |

### Files 500 - 999 lines

| File | Lines | Size (KB) |
|---|---:|---:|
| `lib/engine/matching.ts` | 990 | 52.9 |
| `lib/engine/source-driven-tender-text-parser.ts` | 907 | 36.0 |
| `lib/engine/canonical-field-state.ts` | 885 | 41.6 |
| `lib/engine/methodology-tables.ts` | 860 | 72.4 |
| `app/api/tenders/[id]/download/route.ts` | 845 | 44.2 |
| `lib/engine/export-readiness.ts` | 844 | 49.1 |
| `components/tender-recovery-command-center.tsx` | 828 | 42.9 |
| `components/export-readiness-panel.tsx` | 826 | 44.1 |
| `tests/lifecycle-truth-regression.test.ts` | 826 | 34.5 |
| `lib/engine/tender-release-snapshot.ts` | 825 | 34.0 |
| `app/dashboard/analytics/page.tsx` | 824 | 34.5 |
| `lib/engine/generation-readiness-gate.ts` | 822 | 41.5 |
| `lib/ai-job-handlers.ts` | 800 | 40.8 |
| `lib/tender-generation-readiness.ts` | 799 | 43.6 |
| `lib/engine/build-plan.ts` | 788 | 45.3 |
| `docs/audits/2026-06-02-production-gap-audit.md` | 766 | 43.2 |
| `lib/ai-jobs/analysis-job-service.ts` | 752 | 33.3 |
| `README.md` | 747 | 43.4 |
| `lib/engine/run-tender-engine.ts` | 730 | 43.5 |
| `tests/generate-docs-gate.test.ts` | 723 | 33.5 |
| `lib/engine/submission-plan.ts` | 711 | 28.8 |
| `app/api/company/plan-b-import/route.ts` | 708 | 31.7 |
| `lib/document-generation/haec-service-methodology.ts` | 701 | 39.5 |
| `app/api/tenders/[id]/ai-proposal/route.ts` | 693 | 35.0 |
| `lib/engine/document-quality-gate.ts` | 692 | 31.0 |
| `tests/golden-corpus-acceptance.test.ts` | 690 | 29.8 |
| `lib/engine/tender-metadata.ts` | 684 | 30.9 |
| `tests/environment-variable-reconciliation.test.ts` | 684 | 23.5 |
| `components/tender-controls-panel.tsx` | 681 | 29.5 |
| `tests/ai-analyze-acceptance-harness.test.ts` | 679 | 35.9 |
| `app/api/tenders/[id]/metadata-override/route.ts` | 675 | 33.3 |
| `lib/engine/personnel-deep.ts` | 673 | 36.9 |
| `lib/ai-provider-registry.ts` | 669 | 25.7 |
| `tests/generic-tender-intelligence-fixtures.test.ts` | 668 | 28.7 |
| `components/requirement-coverage-panel.tsx` | 667 | 34.7 |
| `lib/engine/canonical-workflow-decision.ts` | 664 | 32.0 |
| `tests/source-driven-tender-detail.test.ts` | 664 | 23.6 |
| `tests/extraction-quality-dashboard.test.ts` | 651 | 28.1 |
| `lib/engine/tender-evidence-selector.ts` | 646 | 23.7 |
| `components/engine-action-panel.tsx` | 642 | 32.0 |
| `lib/engine/proposal-quality-scorer.ts` | 640 | 40.2 |
| `lib/engine/beyond-spec-tables.ts` | 639 | 59.5 |
| `lib/engine/final-package-readiness-model.ts` | 636 | 26.7 |
| `tests/tender-facts-ledger-runtime-authority.test.ts` | 632 | 32.2 |
| `lib/engine/company-evidence-matching.ts` | 626 | 23.2 |
| `tests/release-blockers-integration.test.ts` | 609 | 34.7 |
| `tests/canonical-workflow-truth-precondition-gates.test.ts` | 604 | 27.1 |
| `lib/engine/effective-tender-facts.ts` | 600 | 28.2 |
| `tests/metadata-source-enrichment.test.ts` | 587 | 25.3 |
| `docs/audits/legacy-overlap-dependency-map.md` | 582 | 41.2 |
| `app/api/tenders/[id]/generate-missing-plan-files/route.ts` | 572 | 24.7 |
| `tests/metadata-evidence-proof.test.ts` | 570 | 28.6 |
| `lib/document-generation/tender-document-composer.ts` | 564 | 22.2 |
| `tests/tender-operation-gate.test.ts` | 561 | 20.9 |
| `lib/ai-analyze/production-analysis-service.ts` | 551 | 14.3 |
| `lib/engine/runtime-readiness-facts.ts` | 544 | 21.9 |
| `tests/buildplan-generation-pipeline.test.ts` | 543 | 28.0 |
| `lib/engine/tender-metadata-completeness.ts` | 536 | 26.6 |
| `components/client-submission-details-panel.tsx` | 531 | 22.6 |
| `app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx` | 529 | 24.3 |
| `tests/analysis-quality-multifactor.test.ts` | 529 | 26.7 |
| `lib/engine/tender-fact-authority.ts` | 528 | 19.1 |
| `tests/tender-lifecycle-orchestrator.test.ts` | 526 | 24.8 |
| `lib/company-knowledge-import-safe.ts` | 522 | 25.3 |
| `lib/engine/bid-strategy.ts` | 522 | 23.4 |
| `tests/tender-delete-pglite-integration.test.ts` | 521 | 24.2 |
| `lib/engine/seven-pass-generation-wiring.ts` | 518 | 22.5 |
| `tests/canonical-readiness-contradictions.test.ts` | 518 | 25.5 |
| `tests/export-package-flow.test.ts` | 517 | 21.7 |
| `lib/engine/ai-multi-perspective-matcher.ts` | 513 | 25.9 |
| `lib/engine/deliverable-and-phases.ts` | 513 | 24.5 |
| `app/dashboard/tenders/page.tsx` | 510 | 23.3 |
| `lib/engine/evaluator-simulator.ts` | 509 | 25.9 |
| `tests/ai-analyze-resume.test.ts` | 507 | 23.8 |
| `tests/ai-analyze-chunked.test.ts` | 503 | 20.4 |
| `lib/engine/win-themes-table.ts` | 500 | 23.4 |

## Files by category

### REVIEWED_RUNTIME (704 files)

- `app/api/admin/ai-environment-readiness/route.ts` (15 lines)
- `app/api/admin/ai-provider-health/route.ts` (84 lines)
- `app/api/admin/ai-provider-health/test/route.ts` (346 lines)
- `app/api/admin/ai-provider-health/zai-diagnostic/route.ts` (126 lines)
- `app/api/admin/ai-usage/route.ts` (137 lines)
- `app/api/admin/db-integrity/preview/route.ts` (158 lines)
- `app/api/admin/db-integrity/route.ts` (207 lines)
- `app/api/admin/db-recovery/route.ts` (38 lines)
- `app/api/admin/db-stats/route.ts` (55 lines)
- `app/api/admin/diagnostics/route.ts` (141 lines)
- `app/api/admin/generated-proposals/audit/route.ts` (457 lines)
- `app/api/admin/generated-proposals/reassess/route.ts` (308 lines)
- `app/api/admin/provider-health/route.ts` (35 lines)
- `app/api/admin/release-stuck-jobs/route.ts` (77 lines)
- `app/api/admin/repair/route.ts` (300 lines)
- `app/api/ai-jobs/[id]/recover/route.ts` (166 lines)
- `app/api/ai-jobs/[id]/route.ts` (45 lines)
- `app/api/ai-jobs/route.ts` (31 lines)
- `app/api/ai-jobs/run-next/route.ts` (214 lines)
- `app/api/ai-providers/diagnostics/route.ts` (51 lines)
- `app/api/ai-runtime/route.ts` (20 lines)
- `app/api/ai/health/route.ts` (134 lines)
- `app/api/analytics/route.ts` (104 lines)
- `app/api/audit/route.ts` (39 lines)
- `app/api/auth/forgot-password/route.ts` (103 lines)
- `app/api/auth/login/route.ts` (151 lines)
- `app/api/auth/logout/route.ts` (16 lines)
- `app/api/auth/me/route.ts` (16 lines)
- `app/api/auth/reset-password/route.ts` (5 lines)
- `app/api/company/assets/[id]/route.ts` (95 lines)
- ... and 674 more (see inventory.json)

### REVIEWED_TEST (555 files)

- `__tests__/no-filecontent-in-list-endpoints.test.ts` (4 lines)
- `__tests__/provider-health-store.test.ts` (6 lines)
- `e2e/auth.spec.ts` (14 lines)
- `e2e/cross-user-isolation.spec.ts` (170 lines)
- `e2e/golden-tender-workflow.spec.ts` (133 lines)
- `e2e/health.spec.ts` (18 lines)
- `e2e/manual-tender-facts-flexibility.spec.ts` (141 lines)
- `e2e/production-smoke.spec.ts` (179 lines)
- `e2e/share-link.spec.ts` (14 lines)
- `e2e/tablet-universal-tender-intelligence.spec.ts` (267 lines)
- `e2e/tender-list.spec.ts` (22 lines)
- `e2e/tender-pipeline.spec.ts` (124 lines)
- `tests/action-icons-visibility.test.ts` (381 lines)
- `tests/admin-audit-route-guards.test.ts` (61 lines)
- `tests/ai-analysis-token-budget-and-error-surfacing.test.ts` (94 lines)
- `tests/ai-analyze-acceptance-harness.test.ts` (679 lines)
- `tests/ai-analyze-and-generation-gate-wiring.test.ts` (418 lines)
- `tests/ai-analyze-auto-retry.test.ts` (262 lines)
- `tests/ai-analyze-checkpoint-bootstrap.test.ts` (112 lines)
- `tests/ai-analyze-checkpoint-persistence.test.ts` (96 lines)
- `tests/ai-analyze-checkpoints.test.ts` (151 lines)
- `tests/ai-analyze-chunk-relation-regression.test.ts` (53 lines)
- `tests/ai-analyze-chunked.test.ts` (503 lines)
- `tests/ai-analyze-fallback.test.ts` (124 lines)
- `tests/ai-analyze-placeholder-guard.test.ts` (114 lines)
- `tests/ai-analyze-promotion-behavior.test.ts` (97 lines)
- `tests/ai-analyze-recovery-stale-content.test.ts` (383 lines)
- `tests/ai-analyze-regression-guards.test.ts` (278 lines)
- `tests/ai-analyze-resume-state.test.ts` (125 lines)
- `tests/ai-analyze-resume.test.ts` (507 lines)
- ... and 525 more (see inventory.json)

### REVIEWED_CONFIG (31 files)

- `.env.example`
- `.github/CONTROLLED_RELEASE.md` (74 lines)
- `.github/pull_request_template.md` (91 lines)
- `.github/workflows/branch-policy.yml` (52 lines)
- `.github/workflows/ci.yml` (158 lines)
- `.github/workflows/datadog-synthetics.yml` (32 lines)
- `.github/workflows/dependency-audit.yml` (60 lines)
- `.github/workflows/drain-ai-job-queue.yml` (143 lines)
- `.github/workflows/gap-closure-branch.yml` (66 lines)
- `.github/workflows/generate-ai-policy-repair.yml` (35 lines)
- `.github/workflows/lockfile-refresh-artifact.yml` (47 lines)
- `.github/workflows/post-deploy-health.yml` (35 lines)
- `.github/workflows/release-hardening-contract.yml` (24 lines)
- `.gitignore`
- `.nvmrc`
- `.prettierrc`
- `electron-builder.json` (39 lines)
- `electron/main.js` (188 lines)
- `engineering.plugin`
- `eslint.config.mjs` (48 lines)
- `instrumentation.ts` (66 lines)
- `middleware.ts` (175 lines)
- `next-env.d.ts` (6 lines)
- `next.config.js` (85 lines)
- `package.json` (93 lines)
- `playwright.config.ts` (61 lines)
- `postcss.config.mjs` (6 lines)
- `tailwind.config.ts` (15 lines)
- `tsconfig.json` (48 lines)
- `types.d.ts` (1 lines)
- ... and 1 more (see inventory.json)

### REVIEWED_MIGRATION (39 files)

- `prisma/migrations/20260601000000_init/migration.sql` (1,125 lines)
- `prisma/migrations/20260602000000_add_client_extraction_fields/migration.sql` (13 lines)
- `prisma/migrations/20260602000000_add_extraction_quality_fields/migration.sql` (19 lines)
- `prisma/migrations/20260604000000_add_source_traceability_and_client_fields/migration.sql` (29 lines)
- `prisma/migrations/20260605000000_add_tender_share/migration.sql` (30 lines)
- `prisma/migrations/20260605000001_tender_share_add_columns/migration.sql` (8 lines)
- `prisma/migrations/20260605000002_add_tender_copilot_messages/migration.sql` (25 lines)
- `prisma/migrations/20260606000000_add_copilot_message_created_at_index/migration.sql` (4 lines)
- `prisma/migrations/20260608000000_add_tender_metadata_override/migration.sql` (35 lines)
- `prisma/migrations/20260610000000_add_requirement_source_extraction_method/migration.sql` (2 lines)
- `prisma/migrations/20260611000000_add_ai_analyze_chunks/migration.sql` (27 lines)
- `prisma/migrations/20260612000000_add_ai_job_versioning/migration.sql` (30 lines)
- `prisma/migrations/20260613190000_comprehensive_gap_guards/migration.sql` (258 lines)
- `prisma/migrations/20260614000000_add_password_reset_and_rate_limit_tables/migration.sql` (38 lines)
- `prisma/migrations/20260614170000_security_session_reset_rate_limit/migration.sql` (32 lines)
- `prisma/migrations/20260619120000_add_tenderfile_deletion_columns/migration.sql` (18 lines)
- `prisma/migrations/20260620120000_add_missing_fk_indexes/migration.sql` (55 lines)
- `prisma/migrations/20260620160000_add_ai_usage_records/migration.sql` (23 lines)
- `prisma/migrations/20260621193000_add_provider_health_capability_times/migration.sql` (8 lines)
- `prisma/migrations/20260622130000_add_worker_lease_fields/migration.sql` (12 lines)
- `prisma/migrations/20260622193000_add_readiness_durable_records/migration.sql` (51 lines)
- `prisma/migrations/20260623160000_add_ai_analyze_chunk_job_and_failure_columns/migration.sql` (27 lines)
- `prisma/migrations/20260624000000_add_ai_analyze_retry_state/migration.sql` (34 lines)
- `prisma/migrations/20260628000000_add_aiusagerecord_tender_fk/migration.sql` (18 lines)
- `prisma/migrations/20260629000000_add_tender_deletion_context/migration.sql` (94 lines)
- `prisma/migrations/20260629300000_add_metadata_source_file_ids_and_build_plan/migration.sql` (40 lines)
- `prisma/migrations/20260630000000_persisted_submission_plan_evidence/migration.sql` (114 lines)
- `prisma/migrations/20260701000000_add_build_plan_confirmation_fields/migration.sql` (60 lines)
- `prisma/migrations/20260702000000_add_title_deadline_email_source_evidence/migration.sql` (20 lines)
- `prisma/migrations/20260703000000_add_reference_submission_email_subject_source_evidence/migration.sql` (11 lines)
- ... and 9 more (see inventory.json)

### REVIEWED_DOCUMENTATION (89 files)

- `.jules/bolt.md` (17 lines)
- `AGENTS.md` (45 lines)
- `CLAUDE.md` (208 lines)
- `CLAUDE_TASKS.md` (187 lines)
- `DECISIONS_NEEDED.md` (113 lines)
- `DIAGNOSE_AI_ANALYZE.md` (238 lines)
- `NOTES.md` (3 lines)
- `README.md` (747 lines)
- `SECURITY.md` (16 lines)
- `capability_report.md` (25 lines)
- `docs/AI_ANALYZE_ACCEPTANCE_RESULTS.md` (228 lines)
- `docs/AI_ANALYZE_ACCEPTANCE_RUNBOOK.md` (391 lines)
- `docs/AI_ANALYZE_PERMANENT_CONSOLIDATION_AUDIT.md` (33 lines)
- `docs/FINAL_RELEASE_ACCEPTANCE_CHECKLIST.md` (89 lines)
- `docs/OPEN_PR_AUDIT.md` (164 lines)
- `docs/PHASE_0_COMPLETION_SUMMARY.md` (253 lines)
- `docs/PHASE_1_IMPLEMENTATION_PLAN.md` (236 lines)
- `docs/PHASE_1_ROUTE_INTEGRATION_GUIDE.md` (272 lines)
- `docs/PHASE_1_ROUTE_REFACTORING.md` (293 lines)
- `docs/PHASE_1_SESSION_SUMMARY.md` (95 lines)
- `docs/PHASE_2_STATUS_AND_ROADMAP.md` (214 lines)
- `docs/POST_1053_1054_PRODUCTION_GAP_CLOSURE.md` (57 lines)
- `docs/PRODUCTION_ENGINE_GAP_CLOSURE.md` (111 lines)
- `docs/PRODUCTION_NEXT_LEVEL_AUDIT.md` (147 lines)
- `docs/PRODUCTION_RELIABILITY_RUNBOOK.md` (253 lines)
- `docs/PR_CONSOLIDATION_792_798.md` (456 lines)
- `docs/RELEASE_GUARDRAILS.md` (40 lines)
- `docs/RELEASE_HARDENING_14_PHASES.md` (48 lines)
- `docs/ai-provider-order.md` (79 lines)
- `docs/ai-provider-runbook.md` (105 lines)
- ... and 59 more (see inventory.json)

### GENERATED_OR_VENDOR (2 files)

- `bun.lock`
- `package-lock.json` (9,292 lines)

### NOT_APPLICABLE_WITH_REASON (54 files)

- `.jules/obsolete_scripts/fix_ai_health_db_final.py`
- `.jules/obsolete_scripts/fix_ai_health_db_v2.py`
- `.jules/obsolete_scripts/fix_ai_provider_health_db.py`
- `.jules/obsolete_scripts/fix_anchors.py`
- `.jules/obsolete_scripts/fix_anchors_v2.py`
- `.jules/obsolete_scripts/fix_ci.py`
- `.jules/obsolete_scripts/fix_generate_missing.py`
- `.jules/obsolete_scripts/fix_route.py`
- `.jules/obsolete_scripts/fix_test_paths.py`
- `.jules/obsolete_scripts/fix_test_paths_v2.py`
- `.jules/obsolete_scripts/fix_test_route.py`
- `.jules/obsolete_scripts/fix_test_statuses.py`
- `.jules/obsolete_scripts/fix_ui_statuses.py`
- `.jules/obsolete_scripts/transform_ai_final.py`
- `.jules/obsolete_scripts/transform_ai_v12.py`
- `.jules/obsolete_scripts/transform_ai_v13.py`
- `.jules/obsolete_scripts/transform_ai_v14.py`
- `.jules/obsolete_scripts/transform_ai_v15.py`
- `.jules/obsolete_scripts/transform_store_final.py`
- `.vercel-redeploy`
- `.vercelredeploy`
- `LICENSE`
- `electron/electron-builder.json` (59 lines)
- `scripts/apply-ui-fixes.py`
- `scripts/audit-allowlists/legacy-tender-facts-internal.json` (10 lines)
- `scripts/comprehensive-fix-v2.py`
- `scripts/comprehensive-fix-v3.py`
- `scripts/comprehensive-fix-v4.py`
- `scripts/comprehensive-fix-v5.py`
- `scripts/comprehensive-fix-v6.py`
- ... and 24 more (see inventory.json)

## Methodology and limitations

- File list: `git ls-files` (all tracked files, no ignored).
- Line counts: counted for text file extensions only; binary files marked `null`.
- Classification: deterministic per-path rules (see `scripts/pass1_inventory.py`).
- **No file was silently skipped.** Files marked `GENERATED_OR_VENDOR` are by definition not subject to manual review (lockfiles, build outputs, dependency caches). Files marked `NOT_APPLICABLE_WITH_REASON` are mostly root-level binary assets or non-source files that do not fit any review category.
- The machine-readable JSON contains every tracked file with its category, size, and line count for programmatic querying.
