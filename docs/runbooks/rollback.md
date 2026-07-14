# Vercel Rollback Runbook

**Branch:** `fix/exhaustive-current-gap-cleanup`
**Addresses audit gap:** GAP-DEVOPS-03

## Purpose

Step-by-step procedure to roll back a Vercel production deployment to the
previous known-good version. Use this when a deploy causes a regression that
cannot be hot-fixed within 15 minutes.

## Prerequisites

- Vercel CLI installed and authenticated (`npm i -g vercel && vercel login`).
- The Vercel project URL (e.g. `https://yourapp.vercel.app`).
- Hope Engineering's Vercel project name.

## Procedure

### 1. Identify the bad deployment

```bash
# List recent production deployments
vercel ls --prod

# Output example:
# > Deployments for hope-tender-path-b [3m ago]
#   https://hope-tender-path-b-abc1234-hope.vercel.app  [Ready]  abc1234 (current)
#   https://hope-tender-path-b-def5678-hope.vercel.app  [Ready]  def5678
#   https://hope-tender-path-b-ghi9012-hope.vercel.app  [Ready]  ghi9012
```

Note the deployment URL of the last known-good version (the one BEFORE the
bad deploy). In the example above, `def5678` is the previous deployment.

### 2. Promote the previous deployment

```bash
# Promote the previous deployment to production
vercel promote https://hope-tender-path-b-def5678-hope.vercel.app

# Verify the promotion
vercel ls --prod
# The def5678 deployment should now be marked [Current Production]
```

### 3. Verify the rollback

```bash
# Health check
curl -s https://yourapp.vercel.app/api/health
# Expected: { "ok": true, "timestamp": "..." }

# Version check (confirms which commit is live)
curl -s https://yourapp.vercel.app/api/version
# Expected: { "gitCommitSha": "def5678...", ... }
```

### 4. Notify

- Post in the engineering Slack channel: `Rollback complete: production now
  serving <commit-sha>. Investigating root cause.`
- If the rollback was triggered by a security incident, also follow
  `docs/runbooks/security-incident.md`.

### 5. Investigate root cause

- Do NOT re-deploy the bad commit.
- Open a GitHub issue titled `Rollback on YYYY-MM-DD — root cause analysis`.
- Link the issue in `operator_handoff.md` Session Log.

### 6. Re-deploy the fix

- Create a fix branch from `main` (not from the rolled-back commit).
- Open a PR with the fix.
- After CI passes and the PR is reviewed, merge to `main`.
- Vercel auto-deploys from `main`.

## Alternative: rollback via npm script

For convenience, a rollback script can be added to `package.json`:

```bash
# Conceptual usage (NOT yet added to package.json — out of scope for this PR)
npm run rollback
# Prompts: "Which deployment to promote? (list recent 5)"
```

The script would wrap `vercel ls --prod` + `vercel promote` with interactive
selection. Defer to a follow-up PR.

## Recovery time objective (RTO)

- **Target:** 5 minutes from detection to rollback complete.
- **Procedure:** this runbook should take < 3 minutes once executed by a
  trained operator.

## Recovery point objective (RPO)

- **Target:** 0 (no data loss).
- **Note:** Vercel rollbacks do not affect the database. If the bad deploy
  included a Prisma migration that modified data, the migration itself must
  be reversed manually. See `docs/runbooks/database-outage.md` for migration
  rollback procedures.

## Limitations

- This runbook assumes the bad deploy did NOT include a destructive Prisma
  migration. If it did, the rollback must also reverse the migration —
  contact the on-call DBA.
- Vercel rollbacks restore the previous DEPLOYMENT, not the previous DATABASE
  STATE. Database rollbacks are handled separately via Neon's point-in-time
  recovery (see `docs/runbooks/database-outage.md`).
