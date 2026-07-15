# Application Worker Contract

**Version:** 2.0  
**Owner:** CHATGPT-M1 — App Manager and Release Controller

## Authority

A durable GitHub Issue is the task authority. The issue body and linked PR comments define the finding, assigned worker, permitted files, target branch, tests, reviewed SHA, and status. Repository finding files are not authoritative.

## Branching

- Runtime repair branches start from `integration/controlled-recovery`.
- Runtime repair PRs target `integration/controlled-recovery`.
- Control Tower infrastructure branches start from `fix/github-control-tower` while PR #1130 is under construction and target `fix/github-control-tower`.
- No worker targets `main`.

## Required procedure

1. Read the assigned issue and all linked PR comments.
2. Confirm the defect still exists on the exact starting SHA.
3. Check open PRs for overlapping files and functions.
4. Post `WORKING` with the starting SHA.
5. Change only permitted files.
6. Add executable tests. Persistence-sensitive work requires PostgreSQL assertions against the real protected rows.
7. Open one draft PR and link the finding ID.
8. Report branch, PR, exact head SHA, changed files, tests, and limitations.
9. Re-read the issue and PR before every new action and whenever the session resumes.
10. Update the same PR after `REVISION_REQUIRED`; never create a replacement PR.

## Prohibited actions

- Merge or approve any PR.
- Deploy or run production migrations.
- Push to `main`, `automation/control-plane`, or `integration/controlled-recovery` directly.
- Change files outside the issue contract.
- Weaken tests, branch protection, extraction, analysis, evidence, Build Plan, generation, ownership, PDF, or ZIP gates.
- Treat regex, templates, deterministic fallback, partial output, or mixed provenance as AI success.

## Non-negotiable application rules

1. Tender documents control scope and requirements.
2. Reviewed Company Vault records are the only factual source for company claims.
3. Never invent evidence, experts, projects, qualifications, values, dates, clients, or commitments.
4. Anthropic remains last in the canonical runtime provider chain.
5. Partial, stale, fallback, or mixed-provenance analysis and generation cannot authorize document creation or export.
6. Roles, ownership, and tenant isolation fail closed.
7. Invalid extraction, stale analysis, missing source grounding, missing reviewed evidence, or missing confirmed Build Plan must leave `GeneratedDocument` count at zero.
8. Final PDF and ZIP remain blocked until approval, integrity, and manifest gates pass.

## Status protocol

`QUEUED` → `WORKING` → `PR_OPENED` → `REVISION_REQUIRED` or `ACCEPTED` → `INCORPORATED`

After three failed attempts, use `BLOCKED`. A changed PR head invalidates prior acceptance.
