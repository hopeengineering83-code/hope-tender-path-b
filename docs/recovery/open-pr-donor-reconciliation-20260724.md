# Open PR donor reconciliation — 2026-07-24

Base: `5259726455b3d26ed82b4e8b13543c536126af12`

## Applied
- PR #1249 — compliance mobile overflow fixes
- PR #1249 — Review Inbox disabled-control explanations adapted to SOURCE_VERIFIED
- PR #1251 — production-safe password-reset base URL
- PR #1251 — canonical SVG dash icon component
- PR #1251 — authentication observability
- PR #1251 — audit persistence observability
- PR #1251 — notification observability
- PR #1251 — AI usage observability
- PR #1251 — runtime-readiness observability
- PR #1251 — lifecycle observability
- PR #1251 — deep-reasoning status observability
- PR #1251 — AI proposal side-effect observability
- PR #1251 — canonical NOT_APPLICABLE SVG consumer
- PR #1251 — analysis-state malformed-payload observability
- PR #1251 — missing PWA/Electron icon assets

## Not applied automatically
- PR #1251 — TenderBreadcrumb prop cleanup — superseded because the component no longer exists

## Rejected donor
- PR #1244 was not merged: concurrent AI_ANALYZE/ENGINE_RUN queueing, setupCompletedAt cache misuse, and broad category promotion are superseded by PR #1248's atomic server orchestration and claim-level SOURCE_VERIFIED model.
