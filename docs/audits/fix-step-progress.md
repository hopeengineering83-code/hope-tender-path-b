# Step-by-step export fixes progress

This branch extends PR #426 after PRs #424 and #425.

Status:

- PR #426 export-policy readiness surfacing is already present.
- Remaining focused fixes are pricing-hygiene false positives, PDF-aware final validation, PDF visible-text leakage scanning, and generated-document storage migration.

Do not merge stale PRs directly. Keep all export package changes guarded by CI, Vercel, and Datadog checks.
