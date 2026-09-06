# Real end-to-end pipeline drive

A development harness for driving one tender from intake to a downloadable
final ZIP against the **real** HTTP routes, a **real** PostgreSQL database and a
**real** authenticated session. It exists because the automated suite cannot
tell a working product from a broken one: it asserts source text and fixture
literals, never produced bytes.

This is diagnostic tooling, not production code. Nothing here is imported by the
application.

## Files

| File | Purpose |
| --- | --- |
| `pipeline-drive-seed.mjs` | Creates a user, a company vault with real documents, and a signed session; prints the session cookie. |
| `pipeline-drive-fixture.mjs` | Tender A — a two-envelope RFP (separate technical and financial files). |
| `pipeline-drive-fixture-b.mjs` | Tender B — an EOI submitted as email attachments, so a single package is compliant. |
| `pipeline-drive.mjs` | Drives every step and stops at the FIRST point that cannot continue, printing the actual response. |
| `local-ai-provider.mjs` | A local OpenAI-compatible provider (see below). |
| `make-financial-proposal-docx.mjs` | Builds a real `.docx` to attach as the official original for a priced file the app refuses to invent. |

## Why a local AI provider

`canExportWithAnalysisState` accepts only `AI_SUCCEEDED`. Regex fallback cannot
authorise a Build Plan, so with no vendor key the pipeline can never reach a
ZIP. `local-ai-provider.mjs` speaks the OpenAI chat-completions wire format over
real HTTP, so the app's own provider client, retry, health and promotion paths
all execute unmodified — only the model vendor is local. Point Cerebras at it:

```
CEREBRAS_API_KEY=local-drive-key
CEREBRAS_BASE_URL=http://127.0.0.1:4599/v1
CEREBRAS_ANALYSIS_MODEL=local-analysis
CEREBRAS_PROPOSAL_MODEL=local-analysis
```

## Running

```bash
# 1. PostgreSQL + schema
createdb hope_tender
DATABASE_URL=postgresql://... npx prisma migrate deploy

# 2. Local provider
node scripts/local-ai-provider.mjs &

# 3. App
npx next dev -p 3100 &

# 4. Seed, then drive
node scripts/pipeline-drive-seed.mjs            # prints {"cookie": "..."}
DRIVE_COOKIE=<cookie> DRIVE_FIXTURE=b node scripts/pipeline-drive.mjs

# 5. The artifact
curl -b "hope_session=<cookie>" \
  "http://127.0.0.1:3100/api/tenders/<id>/download?type=zip" -o final.zip
```

`DRIVE_FIXTURE=b` selects the EOI tender; the default is the two-envelope RFP.
Tender A is a two-envelope RFP, so `detectSubmissionPackageMode` returns
`SEPARATE_TECHNICAL_FINANCIAL` and an un-enveloped `?type=zip` is refused with
`SEPARATE_ENVELOPE_REQUIRED` — submitting one mixed archive would be
non-compliant. That refusal is correct behaviour, not a defect. Envelope-aware
packaging IS implemented: ask for each sealed envelope by name.

```bash
curl -b "hope_session=<cookie>" \
  "http://127.0.0.1:3100/api/tenders/<id>/download?type=zip&envelope=technical" -o technical.zip
# ...and &envelope=financial, &envelope=admin
```

For an assertion that runs in CI, see
`tests/final-zip-produces-real-bytes.test.ts`.

## Driving a benchmark the repository does not carry

Two path overrides exist so real benchmark material can drive the harness
without being committed. A real tender names client staff and their email
addresses, and a company authority export is the firm's commercial record with
client names and contract values; neither belongs in a public repository, so
only the path is configured.

```bash
DRIVE_VAULT_JSON=/path/to/company_knowledge_authority.json \
  node scripts/pipeline-drive-seed.mjs

DRIVE_COOKIE=<cookie> \
DRIVE_TENDER_FILE=/path/to/tender.txt \
DRIVE_TENDER_TITLE="…" \
  node scripts/pipeline-drive.mjs
```

`DRIVE_TENDER_FILE` overrides the built-in fixtures; `DRIVE_TENDER_TITLE`,
`DRIVE_TENDER_FILENAME` and `DRIVE_TENDER_REFERENCE` label it and default to the
file's basename.

`DRIVE_VAULT_JSON` replaces the six hand-written vault summaries with the firm's
actual portfolio, chunked so no file exceeds the per-document extraction ceiling.
This matters for measurement rather than for reaching a ZIP: with six documents
there is nothing for project or expert selection to choose between, so a run
against the built-ins cannot show whether the pipeline picks the *relevant*
project — only that it picks *a* project.

Records are emitted from each entry's own `rawText` verbatim. Paraphrasing them
here would quietly become the "original source evidence" that the grounding
hierarchy trusts above every other tier.
