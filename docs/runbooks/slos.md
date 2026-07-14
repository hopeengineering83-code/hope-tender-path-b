# Service Level Objectives (SLOs)

**Branch:** `fix/exhaustive-current-gap-cleanup`
**Generated:** 2026-07-15
**Addresses audit gap:** GAP-DEVOPS-06

## Purpose

This document defines the service-level objectives for the Hope Tender Engine.
SLOs are the contract between the engineering team and the operator (Hope
Engineering). When error budgets are exhausted, feature deploys freeze until
the budget recovers.

## SLO definitions

### Availability

| Tier | Target | Window | Measurement |
|---|---|---|---|
| Critical (auth, login, dashboard, tender list) | 99.5% | 30 days | `1 - (failed_requests / total_requests)` from Vercel logs |
| Standard (AI Analyze, Generate, Export) | 99.0% | 30 days | Same, excluding provider-outage-induced 5xx |
| Best-effort (admin diagnostic routes, share-link views) | 95.0% | 30 days | Same |

**Error budget:** 99.5% availability over 30 days = 3.6 hours of allowed downtime. When cumulative downtime exceeds 1.8 hours (half the budget) in a rolling 14-day window, feature deploys freeze until the next window resets.

### Latency

| Route class | p50 | p95 | p99 |
|---|---|---|---|
| Read API (`GET /api/tenders`, `GET /api/tenders/[id]`) | 200ms | 500ms | 2s |
| Mutation API (`POST`, `PATCH`, `DELETE`) | 400ms | 2s | 5s |
| AI Analyze (`POST /api/tenders/[id]/ai-analyze`) | 5s | 30s | 55s |
| Generate (`POST /api/tenders/[id]/generate`) | 10s | 45s | 55s |
| Download ZIP (`GET /api/tenders/[id]/download`) | 1s | 5s | 15s |
| Dashboard page (RSC) | 300ms | 1.5s | 4s |

**Budget violation:** if p95 exceeds target for 3 consecutive days, the team
freezes feature deploys on the affected route class until p95 returns to target
for 3 consecutive days.

### AI Analyze success rate

| Metric | Target | Notes |
|---|---|---|
| AI Analyze success rate (excluding provider outages) | >= 95% | `SUCCEEDED + PARTIAL_SUCCESS / total_attempts` |
| AI Analyze retry success rate | >= 80% | `rearm → SUCCEEDED / rearms` |
| Provider fallback trigger rate | <= 20% | High fallback rate indicates provider-health issue |

### Final ZIP export success rate

| Metric | Target | Notes |
|---|---|---|
| Final ZIP download success rate | >= 99% | This is the critical path — a failed ZIP blocks submission |
| Byte-integrity verification pass rate | 100% | Any failure here is a critical incident |
| Export-package rejection rate | <= 1% | Higher rate indicates generation-quality regression |

### Database

| Metric | Target | Notes |
|---|---|---|
| Prisma query p95 | 100ms | Excluding migrations and known slow aggregations |
| Connection pool saturation | < 80% | Above 80% triggers connection_limit review |
| Migration deploy time | < 60s | Long deploys block CI |

## Monitoring

### Datadog synthetics (already configured)

- `datadog-synthetics.yml` workflow runs synthetic tests against the deployed URL.
- Configure `DD_API_KEY`, `DD_APP_KEY`, and `DD_SYNTHETICS_TEST_ID` as repo secrets to enable.

### Recommended additional monitors

1. **Vercel Speed Insights** — enable in `next.config.js` for client-side RUM.
2. **Sentry** — set `SENTRY_DSN` to capture server-side errors with stack traces.
3. **Uptime monitor** — external service (UptimeRobot / Better Stack) pinging
   `/api/health` every minute. Alerts on call regardless of Vercel status.
4. **DB monitor** — Neon's built-in `pg_stat_statements` to track slow queries.

## Error budget policy

When error budget is exhausted for any SLO:

1. **Engineering freeze** — no new feature PRs merge to `main` until budget recovers.
2. **Hotfix-only deploys** — only SLO-recovery fixes deploy.
3. **Post-mortem** — within 48 hours, the team publishes a post-mortem in
   `docs/audits/postmortem-YYYY-MM-DD-<incident>.md`.
4. **Action items** — post-mortem action items tracked in `operator_handoff.md`.

## Review cadence

- **Weekly** — engineering review of SLO dashboards.
- **Monthly** — adjust SLO targets if actuals consistently exceed or fall short.
- **Quarterly** — full SLO review with operator (Hope).

## Limitations

This document defines targets; it does NOT include the dashboards or alerting
infrastructure to enforce them. Operators must:

1. Configure Datadog (or equivalent) to ingest Vercel logs + Sentry events.
2. Build SLO dashboards from the metrics defined above.
3. Wire alerts to on-call rotation.

Until those are in place, SLO compliance is reviewed manually via the weekly
engineering review.
