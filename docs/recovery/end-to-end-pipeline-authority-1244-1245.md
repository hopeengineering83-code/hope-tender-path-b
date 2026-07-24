# End-to-end pipeline authority consolidation

This branch starts from PR #1175 exact head and incorporates the useful frontend workflow improvements from PR #1245 while preserving the non-negotiable source-authority and release gates.

## Required corrections before incorporation into PR #1175

- One pipeline owner only; no duplicate client and server AI Analyze trigger.
- Explicit analysis-to-engine dependency; independently queued jobs are not accepted as ordered.
- Company profile and summary documents cannot become authoritative expert/project evidence based on broad content patterns.
- Content detection may only suggest human recategorization.
- Partial, failed, or regex-only analysis remains blocked from Build Plan, generation, GeneratedDocument creation, validation, approval, and export.
- Action Center must route to canonical mutation owners rather than become a competing owner.
- Final ZIP and byte-integrity gates remain unchanged and fail closed.

## Validation required on final exact SHA

- full CI
- PostgreSQL integration tests
- authenticated owner workflow
- cross-user isolation
- exact-head route and screenshot audit
- representative Company Vault and tender acceptance test
