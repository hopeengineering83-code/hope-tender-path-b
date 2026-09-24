# Preview recovery runbook

Two problems have recurred every time the owner swaps the Preview database or
redeploys the Preview: the app loses its database schema, and AI output falls
back to the deterministic draft. This file records how each was actually
solved (2026-09-07, 09-11, 09-19, 09-22, 09-24) so the next session repeats the
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
