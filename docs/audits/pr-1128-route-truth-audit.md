# PR #1128 route-truth audit

Date: 2026-07-16 UTC  
Replacement branch: `fix/pr1128-route-truth-audit`

## Audit boundary

The local PR #1128 commit (`39ea6d19`) and its complete 756-line diff were reviewed against the route implementations and canonical package model. GitHub's private PR page, inline comments, CI artifacts, and screenshot attachments were not downloadable in this environment: no Git remote or GitHub CLI/token was configured, the unauthenticated GitHub page returned HTTP 401, and the API request was denied. No local screenshot artifact or attachment URL exists in the repository. This audit therefore does not claim to have inspected unavailable screenshots.

No visual component or icon was changed. The repaired behavior is server-side route truth, so an app screenshot would not prove the JSON contracts or database-backed gates under review.

### Screenshot capture follow-up (2026-07-16 UTC)

A second, explicit screenshot attempt was made after the screenshot request:

1. The production app URLs (`/`, `/login`, and `/forgot-password`) could not be reached from either the shell or the web fetch service. The environment's outbound proxy returned HTTP 403, while the web fetch service returned HTTP 401.
2. A local Next.js development server started successfully at `http://127.0.0.1:3000` with non-production placeholder environment values.
3. Playwright is installed as a Node dependency, but its Chromium executable is absent. `npx playwright install chromium` retried the official CDN five times and every download returned HTTP 403.
4. No system Chromium, Chrome, Firefox, WebKit, `wkhtmltoimage`, or repository screenshot artifact is available. The full Git history and working tree contain no PNG, JPEG, or WebP app screenshot to recover.

Consequently, no screenshot was generated or committed. Creating a synthetic image from HTML or source code would not be a screenshot of the running app and would be misleading. A runner with either an installed browser or access to Playwright's browser CDN must run the documented 800×1280 browser capture against an authenticated, seeded deployment.

## Contradictions found in PR #1128

| Area | Before this audit | Production risk | After this audit |
|---|---|---|---|
| Build Plan authority | Generation readiness trusted legacy `exactFileNaming` / `exactFileOrder` fields; final-package readiness could derive a plan and proceed without a confirmed Build Plan. | A stale legacy plan could make generation or export appear ready. | The current confirmed Build Plan is authoritative. No confirmed plan emits `NO_CONFIRMED_BUILD_PLAN` and blocks generation and Final ZIP. |
| Required-document denominator | Different routes counted requirements, generated rows, or manifest rows. | The same tender could display 0/0 on one panel and a non-zero requirement count on another. | All panel-facing count routes consume the final-package model; an unconfirmed derived plan remains display-only so the denominator is non-zero while readiness fails closed. |
| Authority review | Authority review independently reconstructed required files from legacy tender fields. | `Technical Proposal.pdf` could be missing in canonical package truth but absent from authority review's required set. | Authority review uses canonical required package documents and combines document, export, and authority blockers. |
| Document validation | Validation checked generated-document quality but did not enforce canonical package/Build Plan blockers. | A valid individual document could report validation success while Final ZIP remained structurally invalid. | Validation combines quality readiness with final-package blockers and exposes the same canonical counts and public envelope. |
| Public blocker safety | Blocker normalization spread arbitrary internal object properties into public JSON; messages/actions were not sanitized. | Prisma details, SQL text, stack fragments, internal fields, or user-facing “metadata” terminology could leak. | Blockers are allowlisted to four fields, public text is sanitized, and raw server/database diagnostics become a generic recovery-safe message. |
| Envelope precedence | Caller-supplied `READY` and primary reason/action could disagree with blockers or count invariants. | A route could claim ready despite a blocker, or present a primary fix unrelated to its first blocker. | Blockers and impossible counts always fail closed; normalized blockers determine the primary reason/action; explicit `READY` cannot override failure. |

## Route agreement after repair

| Scenario | Lifecycle | Readiness score | Generation readiness | Export readiness | Workflow status | Tender detail / authority / validation |
|---|---|---|---|---|---|---|
| Partial AI Analyze | Blocked; resume/retry action remains canonical | Blocked | Blocked | Blocked | Blocked | No public envelope can report ready |
| No confirmed Build Plan | Blocked by package truth | Blocked | `NO_CONFIRMED_BUILD_PLAN` | `NO_CONFIRMED_BUILD_PLAN` | Blocked | Detail, authority, and validation expose the same package blocker |
| Planned docs without content | Non-zero required count | Same canonical counts | Generated = 0 | Export-ready = 0 and blocked | Same canonical counts | Detail uses the same non-zero denominator |
| Missing `Technical Proposal.pdf` | Blocked through package truth | Blocked | Blocked | Structured missing-document blocker | Blocked | Authority marks missing; validation includes package blocker |
| Valid generation, validation, approval | Counts advance from one model | Same canonical counts | Unlocks only after all gates | Final ZIP unlocks only when `zipReady` | Same final status | Detail, authority, and validation agree |

## Remaining production evidence requirement

The deterministic route/model tests, typecheck, lint, and production build can run without a database. The real handler suite remains guarded by `RUN_DB_INTEGRATION=true`; this environment has no isolated PostgreSQL or seeded tender fixtures. Merge remains unsafe until CI runs the DB route suite and captures the six real route responses for each required scenario.
