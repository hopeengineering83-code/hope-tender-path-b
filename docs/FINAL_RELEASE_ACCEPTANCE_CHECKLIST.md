# Final Release Acceptance Checklist

Owner-facing acceptance checklist for the tender proposal generator. This is a
**release gate**, not a style guide. It complements (does not duplicate) the
guardrail audits in `docs/RELEASE_GUARDRAILS.md` (PR #1014) and the UI/wording
cleanup in PRs #1012 / #1013.

The product rule: **the app must work from real tender files and produce a
trustworthy final package.** Draft generation may proceed with optional Tender
Detail gaps; **final export / final ZIP must remain fail-closed** when required
Tender Facts, Submission Facts, evidence, documents, approvals, or the manifest
are unsafe.

Terminology (no user-facing "metadata"): Tender Details · Source-Grounded Tender
Facts · Submission Facts · Client / Procuring Entity Facts · Deadline and
Submission Instructions · Required Documents · Final Package Facts · Export
Readiness.

---

## 1. Required pre-merge checks

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — clean
- [ ] `npm test` (or the configured CI command) with `RUN_DB_INTEGRATION=true` — all green
- [ ] `npm run build` — succeeds
- [ ] `npx prisma validate` — clean; migrations additive only (no historical migration edits, no column renames)
- [ ] New acceptance tests pass: `release-acceptance-final-package`, `release-acceptance-document-quality`, `release-acceptance-provider-fallback-order`
- [ ] Branch rebased on latest `main` after PRs #1012 / #1013 / #1014 merge

## 2. Required post-merge checks

- [ ] CI green on `main`
- [ ] No Vercel preview churn caused by this branch (do not trigger manual deployments)
- [ ] Release integrity audit / browser smoke tests (if configured) pass

## 3. Manual QA scenario (happy path)

1. Upload at least one real tender source file.
2. Extract text — confirm page markers appear where the source has pages.
3. AI Analyze — confirm requirements, Submission Facts, and Required Documents are produced.
4. Confirm requirements.
5. Build the required-document plan.
6. Generate draft documents.
7. Validate generated documents (quality gate).
8. Approve documents.
9. Check Export Readiness — must be blocked until required docs are validated/approved.
10. Export the final ZIP.
11. Open the ZIP and the manifest.

## 4. Verify in generated Word / PDF / ZIP

- [ ] Every generated DOCX/PDF is **non-empty and openable**.
- [ ] Client / Procuring Entity appears where required; tender title/reference and deadline appear where available.
- [ ] Company name and relevant company profile facts appear.
- [ ] Required sections from the tender are present; requirement-specific evidence is shown where available.
- [ ] Letterhead / header / footer / logo / stamp / signature do not break layout.
- [ ] **Technical and financial documents are not mixed**; pricing does not leak into the technical envelope.
- [ ] Required file names / order are preserved where the tender specifies them.
- [ ] ZIP contains **only** active, approved / export-ready documents.
- [ ] Superseded / historical / failed-validation documents are **excluded**.
- [ ] Manifest entry count equals actual ZIP entry count; filenames are deterministic and safe; duplicates are disambiguated.

## 5. What must NEVER appear in generated output or user-facing errors

- [ ] User-facing "metadata" product wording
- [ ] Raw Prisma / raw server error text (including tender IDs / user IDs)
- [ ] AI traces ("as an AI", system prompts, internal notes, "placeholder unless unavailable")
- [ ] Raw JSON / source parsing artifacts / raw source chunks
- [ ] Internal database IDs
- [ ] Pricing leakage into the technical envelope

## 6. Vercel rule

- Do **not** manually trigger deployments unless explicitly requested.
- Avoid preview churn; run local checks before pushing.

## 7. Release blocker list (any one blocks release)

1. Final ZIP can be produced while Export Readiness is blocked.
2. Final ZIP includes a superseded / stale / failed-validation / unapproved document.
3. Manifest count ≠ ZIP entry count, or manifest fingerprint does not match contents.
4. A generated document is empty, or contains AI traces / raw JSON / internal IDs.
5. Pricing content appears in a TECHNICAL document (or technical methodology in a FINANCIAL document).
6. A user can read / download / mutate another user's tender, files, requirements, plan, documents, approvals, or ZIP.
7. A public API route returns a raw exception / internal ID on failure.
8. Partial or non-promoted AI Analyze authorizes generation or export.
9. AI output overwrites a confirmed source-grounded fact without an audit reason.
10. Automatic provider fallback order deviates from Gemini → Groq → Mistral → Z.ai → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic → deterministic draft fallback (`lib/ai-provider-catalog.cjs`), or a configured provider is excluded from automatic routing on the basis of its access tier. Every configured provider participates; there is no free-only mode and no OpenRouter `:free` requirement.
