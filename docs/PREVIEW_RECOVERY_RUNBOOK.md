# Preview recovery runbook

Two problems have recurred every time the owner swaps the Preview database or
redeploys the Preview: the app loses its database schema, and AI output falls
back to the deterministic draft. This file records how each was actually
solved (2026-09-07, 09-11, 09-19, 09-22, 09-24, 09-26, 09-28, 10-05) so the next session repeats the
fix instead of rediscovering it.

All steps use the workflow `.github/workflows/lockfile-refresh-artifact.yml`
(`workflow_dispatch`, ref `release/consolidated-recovery-20260717`) and the
Preview `https://hope-tender-path-b-git-0db72a-hopeengineering83-codes-projects.vercel.app`.
Never ask the owner for database URLs or credentials; the workflow reads them
from repository secrets.

## A. After a Neon database swap or a Preview redeploy

The owner's usual steps: set `PREVIEW_DATABASE_URL_MIGRATION` (GitHub secret) to
the **unpooled** Neon string, set Vercel `DATABASE_URL` (Preview) to the
**pooled** string, redeploy the Preview.

**Symptom.** `/api/health` returns 503 `database-unreachable` (or
`schemaMatchesDeployedCode:false`), all table probes `null`, and the Vercel
runtime log shows `The column User.deletedAt does not exist in the current
database` (P2022). Cause: on first contact the runtime bootstrap creates an old
schema with no `_prisma_migrations` history, which the current code cannot use.

**Fix, in order:**

1. `confirm=health`. Read-only. Prints two fingerprints:
   - `databaseFingerprint` from `/api/health`: the **pooled** host.
   - `fingerprint (direct)`: the value `provision` needs.
   It also lists the tables and row counts behind the migration secret.
2. Confirm the new database holds no business data: every table 0 rows except
   the 4 canonical `Role` rows. If anything else holds rows, **stop and ask the
   owner**. `provision` would refuse anyway.
3. `confirm=provision`, `expected_fingerprint=<fingerprint (direct)>`. Guarded:
   refuses on fingerprint mismatch or non-empty business tables, takes a
   pg_dump backup, applies the real migrations (`prisma:migrate:safe`, never
   `db push`, never hand-written schema), restores the 4 roles, provisions the
   owner account from `PREVIEW_OWNER_EMAIL`/`PREVIEW_OWNER_PASSWORD`, and
   requires zero drift.
4. Check `/api/health`: `ok:true`, `healthy`, all tables `true`,
   `schemaMatchesDeployedCode:true`.
5. `confirm=ready`. Signs in as the owner and reports the (empty) vault.
6. Tell the owner to re-upload **Company Vault documents + Brand Assets**, then
   the **tender files**. A new database starts empty.

Do not "fix" the P2022 by patching authentication to ignore `deletedAt`.

2026-09-24 instance: fingerprint pooled `47cfc82f1ca9` / direct `7d7f78f1fc58`,
provision run 36025943205, healthy at 16:17Z, ready run 36026336782.

2026-09-26 instance: fingerprint pooled `1e8995727823` / direct `15fd4688c001`,
health run 36251773371 (503, bootstrap schema: 54 tables, no
`_prisma_migrations`, `User.deletedAt` missing, only 4 `Role` rows), provision
run 36251902059 (53/53 migrations, zero drift), healthy at 15:30Z (run
36252145412), ready run 36252281315.

2026-09-28 instance: fingerprint pooled `87d2cb4dbb00` / direct `98cc7113c6b7`,
health run 36423969628 (503, bootstrap schema: 54 tables, no
`_prisma_migrations`, `User.deletedAt` missing, only 4 `Role` rows), provision
run 36424118789 (53/53 migrations, zero drift, owner ADMIN + company created),
healthy at 12:49Z (run 36424331221), ready run 36424405702 (sign-in, 6 pages
and 5 upload APIs 200; `ai_providers` WARNING until the first capability test).

2026-10-05 instance: fingerprint pooled `be37dc0dd53d` / direct `6bf84179d06d`,
health run 37371062616 (503, bootstrap schema: 54 tables, no
`_prisma_migrations`, `User.deletedAt` missing, only 4 `Role` rows), provision
run 37373668639 (53/53 migrations, zero drift, critical-schema ok, owner ADMIN +
company created), `/api/health` healthy at 21:17Z on release `84afe4da`.
**New this time:** GitHub's hosted runners repeatedly failed to start jobs
("The job was not acquired by Runner of type hosted even after multiple
attempts"); four dispatches were cancelled after 15 minutes with no runner.
That is GitHub-side, not the app or the database. Re-dispatch until a runner
takes the job; a small loop that re-dispatches while the job ends `cancelled`
with no runner name did it (`gh api -X POST …/actions/workflows/lockfile-refresh-artifact.yml/dispatches`).
`/api/health` can be read without a runner through the Vercel connector's
`web_fetch_vercel_url`, which is how the 503 and the healthy state were
confirmed here.

2026-10-08 instance: the owner's redeploy first failed to BUILD, not to start:
the Vercel build's runtime dependency audit refused Next.js 15.5.25 over two
cache-poisoning advisories published the day before (GHSA-mcj8-r9mp-w47p,
GHSA-4jqv-mc3x-m676). Fixed by the patch bump to 15.5.27 (`93aa4daf`); the
audit policy was not relaxed. A build that fails in `scripts/audit-dependencies.mjs`
is that, not the database. Then the usual signature on `ep-damp-dawn-b4uu53wo`:
fingerprint pooled `6904b6e89c7c` / direct `8689bebe2fce`, health run
37797403019 (55 bootstrap tables, no `_prisma_migrations`, `User.deletedAt`
missing, 4 `Role` rows, 431 drift statements), provision run 37797908914
(54/54 migrations, zero drift, critical-schema ok, owner ADMIN + company
created), `/api/health` healthy at 15:08Z, ready run 37798622798 (sign-in, 6
pages and 5 upload APIs 200, storage = private Vercel Blob, SMTP not
configured), inspect run 37798747542 (AI Analyze eligible on Gemini, Groq,
Z.ai; generation verified on Gemini, Groq). The previous database had died two
days after provisioning — see section E.

Step 7 of the sequence is section B below. On a new database there is no
tender yet; `confirm=inspect` then skips only its tender-scoped steps and
still runs the provider-chain sweep (before 2026-09-26 it failed at "Resolve
the tender under test" and skipped the sweep).

## B. AI providers after a redeploy

**Symptom.** The package passes every gate but the proposal is the
"deterministic benchmark fallback", or AI Analyze fails. This is almost always
provider capacity or configuration, not code.

**Diagnose, don't guess:** run `confirm=inspect` (with `tender_id` if known).
Read the end of the log:

- `PROVIDER CHAIN`: per provider, for both `analysis` and `generation`.
- `AUTHORSHIP VERDICT`: `FELL BACK BECAUSE:` gives each failed section's
  provider walk.

**Classify each provider and act:**

| What the sweep says | Meaning | Remedy (owner, Vercel Preview env) |
| --- | --- | --- |
| `BILLING`: HTTP 402, "no credits", "Insufficient Balance" | Account out of credit | Top up that provider |
| `AUTH` `tier_not_allowed` (Mistral 403) | The configured model is not in the plan | Set `MISTRAL_PROPOSAL_MODEL`/`MISTRAL_ANALYSIS_MODEL` to a model the plan includes (e.g. `mistral-small-latest`), redeploy |
| `AUTH` "Invalid API key" (Together 401) | Wrong or revoked key | Replace the key, redeploy |
| `PROVIDER_OVERLOAD` 503 (Gemini "high demand") | Provider-side capacity | Transient; retry later |
| `RATE_LIMIT` 429 (Z.ai `1305`, Groq) | Free-tier limits | Code now waits these out (see below) |
| `SKIPPED_NO_CAPACITY(TPM_LIMIT)` | Section too large for that free tier | Provider cannot write that section; needs a paid tier or another provider |

Code never silently swaps a model identifier (CLAUDE.md provider policy). A
model change is an owner env change, and an env change takes effect only after
a **redeploy**. After any provider env change: redeploy, then `inspect` again.

**Code-side fixes already in place (do not redo):**

- Sections are paced, two at a time, largest first (`PROPOSAL_SECTION_CONCURRENCY`).
- A section waits out rate-limit and overload cooldowns up to
  `MAX_SECTION_COOLDOWN_WAITS` times instead of falling back.
- The pool and the Section C drill-down end `PROPOSAL_SECTION_POOL_RESERVE_MS`
  before the 220s proposal guard, so a slow run cannot lose every written
  section to "AI proposal timed out".
- A partial result keeps the model-written sections (owner decision
  2026-09-24): only when every section falls back is the AI output replaced
  by the full deterministic draft. The inspection prints `MIXED AUTHORSHIP:`
  for a partial result.
- Z.ai JSON requests disable thinking; Z.ai/Cerebras/Gemini have worker attempt
  ceilings; a truncated answer is reported as truncated, not malformed.

**What still decides model-backed output:** at least one provider with credit
whose limits fit a full section. As of 2026-09-24 only Groq and Z.ai (free
tiers) passed the probe; Groq's TPM cannot take the Technical Approach section.
Changing the Mistral model or topping up one provider is the fix.

## C. Running the owner's two gates

AI Analyze and Run Engine stay manual owner gates (CLAUDE.md). When the owner
explicitly asks Claude to run them, use `confirm=accept` with `tender_id`: it
signs in as the owner and runs AI Analyze → Run Engine → ZIP → byte
inspection. Follow it with `confirm=inspect` for authorship.

## D. "Run Engine" greyed out under "AI Analyze is not in a release-ready state (current: RUNNING)"

**Diagnose first, from the server, not the screenshot:** Vercel runtime logs for
`/api/ai-jobs` (look for `[finalizeJob] job=… status=SUCCESS`), then
`confirm=inspect` and read `ENGINE READINESS`. If it says
`analysisCurrent: true`, `canRunEngine: true`, the server is ready and the page
is showing a stale answer.

2026-09-27 instance: the owner opened the tender while their AI Analyze was
running (job `348a8cd6`, 11:04→11:05:04 SUCCESS). The Run Engine panel read
readiness once on mount and never re-asked, so the button stayed grey until a
reload. Fixed: the panel now re-checks every 3 s while the analysis is QUEUED
or RUNNING (`components/matching-selected-evidence-panel.tsx`, test
`tests/an-analysis-in-flight-does-not-lock-run-engine.test.ts`). On older
deployments the workaround is a page reload. The earlier cousin (2026-09-23,
"Engine readiness could not be verified … Failed to fetch") is fixed the same
way for a failed check.

## E. "Neon monthly limit reached" within days of a new database

**Symptom.** A freshly provisioned Preview database stops answering after a
day or two (`Can't reach database server at ep-…-pooler…`), and the Neon
console says the project's monthly limit is reached. Swapping to a new Neon
project only restarts the clock.

**Root cause (2026-10-08).** Not the cron and not compute hours: the
**data-transfer (egress) allowance**. The tender page polls
`/api/tenders/[id]/workflow-center` from two components every 8 s (3 s during
a run). Measured through a byte-counting proxy, one poll moved **~18.6 MB**
out of Postgres for an ordinary tender, because `workflow-state` included every
tender file and every generated document — superseded ones too — with their
stored bodies, and the analysis-state resolver included every tender file's
body to read one JSON column, twice per poll. One open tender tab was
gigabytes an hour against a free allowance of a few GB a month. The previous
database (`ep-wandering-credit`, provisioned 10-05) died at 2026-10-07 21:02Z,
right after a day of acceptance runs with tender pages open.

**Fixed in `d4118aa8`:** one poll is ~0.55 MB on the same tender (34× less);
idle polling is 30 s; the snapshot is loaded once per poll; nothing polls from
a hidden tab. `tests/a-tender-page-poll-does-not-download-stored-files-db.test.ts`
caps the bytes one poll may read and fails on the old code. Any new status
read must select metadata only: never `include: { files: true }` or
`generatedDocuments: true` on a polled path.

**Other, smaller drivers (owner options, not code):**

- The **default branch's** scheduled workflow "Drain AiJob queue" (`main`,
  `*/5` cron, throttled by GitHub to every 4–7 h) still POSTs to the Preview
  worker and wakes the Preview database each time. This branch removed that
  schedule, but GitHub runs schedules from `main`. Disable that workflow's
  schedule in the Actions tab if the Preview should sleep; it also drains
  Production's queue, so keep it if Production depends on it.
- Generated documents are stored inline in Postgres and superseded versions
  are kept, so each regeneration adds ~1–2 MB toward the free 0.5 GB storage.
- Neon's paid Launch plan removes the free-plan transfer and storage ceilings
  if the Preview will see heavy daily use.

