# Incident Response Runbook

**Branch:** `fix/exhaustive-current-gap-cleanup`
**Addresses audit gap:** GAP-DEVOPS-08

## Purpose

Master runbook for incident response. Use when a production issue affects
users, data integrity, or security. Per-incident runbooks for specific failure
modes are in sibling files:

- `database-outage.md` — PostgreSQL unreachable or corrupt
- `ai-provider-outage.md` — AI provider chain degradation
- `bad-deploy-rollback.md` — production deploy caused regression
- `oom-timeout-storm.md` — Vercel function OOMs or timeouts
- `rate-limit-storm.md` — rate-limit exhaustion
- `security-incident.md` — suspected breach
- `stuck-ai-jobs.md` — AI job queue not draining

## Severity classification

| Severity | Definition | Response time | Escalation |
|---|---|---|---|
| **SEV-1** | Production down; data loss; security breach | 5 min | Page on-call; notify Hope immediately |
| **SEV-2** | Critical path broken (auth, login, AI Analyze, Generate, Download) | 15 min | Page on-call; notify Hope within 1 hr |
| **SEV-3** | Non-critical feature broken; partial degradation | 1 hr | Slack on-call channel |
| **SEV-4** | Cosmetic; minor UX issue | 1 business day | Slack engineering channel |

## Response procedure

### 1. Detect (0-5 min)

- Alert source: Datadog synthetic, Sentry, user report, Vercel alert.
- Acknowledge the alert in the on-call channel.
- Open an incident channel: `#incident-YYYY-MM-DD-<short-description>`.

### 2. Classify (5-10 min)

- Assign severity using the table above.
- Assign an **Incident Commander** (IC) — the person coordinating, NOT
  necessarily debugging.
- Assign a **Communications Lead** — handles updates to Hope and stakeholders.

### 3. Mitigate (10-30 min)

- Goal: stop the bleeding, NOT to find root cause.
- Options:
  - Rollback production (see `bad-deploy-rollback.md`).
  - Disable affected feature via env var.
  - Scale up Vercel instances.
  - Fail over to backup database (see `database-outage.md`).

### 4. Communicate (every 30 min during SEV-1/2)

- Internal update in incident channel every 30 min.
- External update to Hope every 60 min for SEV-1, every 2 hr for SEV-2.
- Use this template:
  > **Status:** [investigating / mitigating / resolved]
  > **Impact:** [which users / features are affected]
  > **Mitigation:** [what's been done]
  > **Next update:** [time]

### 5. Resolve

- Confirm mitigation restored service.
- Verify via `/api/health` + a manual smoke test (login → upload tender → AI Analyze → Generate → Download).
- Close incident channel.
- Send final update.

### 6. Post-mortem (within 48 hr)

- IC publishes `docs/audits/postmortem-YYYY-MM-DD-<incident>.md`.
- Template:
  ```markdown
  # Post-mortem: <incident title>

  **Date:** YYYY-MM-DD
  **Severity:** SEV-N
  **Duration:** X hours Y minutes
  **IC:** <name>
  **Comms lead:** <name>

  ## Summary
  <1-paragraph executive summary>

  ## Timeline (all times UTC)
  - HH:MM — Detection
  - HH:MM — Acknowledgment
  - HH:MM — Severity assigned
  - HH:MM — Mitigation started
  - HH:MM — Service restored
  - HH:MM — Post-mortem published

  ## Root cause
  <detailed technical explanation>

  ## Contributing factors
  <what made this worse / harder to detect>

  ## What went well
  <3-5 bullets>

  ## What went poorly
  <3-5 bullets>

  ## Action items
  | # | Action | Owner | Due | Tracking |
  |---|---|---|---|---|
  | 1 | ... | ... | ... | issue link |

  ## Lessons learned
  <process / tooling improvements>
  ```

- Action items tracked in `operator_handoff.md` Session Log with due dates.

## On-call rotation

- **Cadence:** weekly rotation, Monday 10:00 UTC handoff.
- **Coverage:** 24/7 for SEV-1; business hours for SEV-3/4.
- **Backup:** secondary on-call handles if primary is unavailable.
- **Handoff:** post in `#oncall` channel: `On-call handoff: <outgoing> →
  <incoming> for week of YYYY-MM-DD. Open items: <list>.`

## Communication channels

| Channel | Use |
|---|---|
| `#oncall` | Alert acks, handoffs, urgent coordination |
| `#incident-YYYY-MM-DD-*` | Per-incident real-time discussion |
| `#engineering` | Non-urgent engineering discussion |
| `#status` | Public status updates (if Hope uses a status page) |
| Email / phone to Hope | SEV-1 / SEV-2 external comms |

## Tools

- **Vercel dashboard** — deployment status, logs, function metrics.
- **Neon dashboard** — DB metrics, query stats, point-in-time recovery.
- **Sentry** — error aggregation (if `SENTRY_DSN` configured).
- **Datadog** — synthetic tests + custom dashboards.
- **GitHub Actions** — CI/CD pipeline status.

## Limitations

This runbook assumes the existence of:
1. An on-call rotation (not yet formalized).
2. Datadog or equivalent monitoring (configured per `datadog-synthetics.yml`).
3. A Slack or equivalent messaging channel.
4. Hope's contact info for SEV-1/2 notification.

If any of these are missing, the operator (Hope) must provision them before
this runbook can be executed as written.
