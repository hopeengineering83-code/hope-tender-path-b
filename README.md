# Hope Tender Proposal Generator

AI-powered tender proposal generation and compliance engine for Hope Urban Planning Architectural and Engineering Consultancy. Built for end-to-end tender workflows: intake → analysis → matching → compliance → generation → validated export.

> This README documents the existing codebase. It is intentionally accurate — it describes what the code actually does, not aspirational features.

## Merge policy

**No PR may be merged if GitHub CI is failed, even when Vercel is green.**

Required passing checks before merging to `main`:
1. **GitHub Actions CI** — "Typecheck, test, and build" (runs typecheck + tests + build)
2. **Vercel** deployment preview
3. **Datadog Synthetic tests** where configured for the affected route

See [`docs/audits/current-readiness-blockers.md`](docs/audits/current-readiness-blockers.md) for
the current list of stale/diverged PRs and active blockers.

---

## Contents

1. [Product architecture](#1-product-architecture)
2. [Folder structure](#2-folder-structure)
3. [Database schema](#3-database-schema)
4. [Main workflows](#4-main-workflows)
5. [API design](#5-api-design)
6. [UI page and component structure](#6-ui-page-and-component-structure)
7. [Environment variables](#7-environment-variables)
8. [Setup, run, deploy](#8-setup-run-deploy)
9. [PWA installation](#9-pwa-installation-mobile--desktop-browser)
10. [Desktop packaging (Electron)](#10-desktop-packaging-electron)
11. [Guardrails enforced in code](#11-guardrails-enforced-in-code)
12. [Generation pipeline — sections produced](#12-generation-pipeline--sections-produced)

---

## 1. Product architecture

**Stack**

| Layer | Technology |
|---|---|
| Runtime | Node.js (Next.js 15.5 App Router) |
| UI | React 19 + Tailwind CSS 3.4 |
| Type system | TypeScript 6 |
| ORM | Prisma 6.19 |
| Database | PostgreSQL (Neon, Supabase, Railway) |
| Auth | bcryptjs + HMAC-signed sessions, Postgres-backed |
| AI (preferred) | Anthropic Claude when `ANTHROPIC_API_KEY` is set (model chain configurable via `ANTHROPIC_PROPOSAL_MODELS`) |
| AI (fallback) | Google Gemini (`gemini-2.5-pro` by default) — used when Claude not configured, and for CV/project extraction |
| Document I/O | `docx` (write), `mammoth` + `pdf-parse` + `pdf2json` + `pdfjs-dist` (read), `xlsx`, `jszip` |
| Validation | `zod` |
| PWA | manifest + service worker (`public/sw.js`) |
| Desktop | Electron + electron-builder (Mac/Win/Linux) |

**High-level shape**

```
┌──────────────────────────────────────────────────────────────────┐
│                    Browser / PWA / Electron                      │
│  app/dashboard/* (React Server Components + Client islands)      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│           Next.js API routes (app/api/**/route.ts)               │
│  • Auth (sessions, bcrypt)   • Company knowledge vault           │
│  • Tender intake/upload      • Tender engine orchestration       │
│  • Compliance matrix         • Export packages                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
     ┌────────────────┐  ┌────────────┐  ┌──────────────┐
     │  lib/engine/   │  │  lib/ai.ts │  │ lib/storage  │
     │  ~30 modules   │  │  Gemini    │  │ + extract-   │
     │  (analysis,    │  │  wrapper   │  │ text         │
     │  matching,     │  │            │  │              │
     │  compliance,   │  │            │  │              │
     │  generation,   │  │            │  │              │
     │  validation)   │  │            │  │              │
     └────────┬───────┘  └─────┬──────┘  └──────┬───────┘
              │                │                 │
              └────────────────┼─────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  Prisma → Postgres  │
                    └─────────────────────┘
```

**Key architectural decisions**

- **Trust-level data model.** `Expert` and `Project` records carry a `trustLevel` field with three states: `REGEX_DRAFT` (pattern-extracted), `AI_DRAFT` (LLM-extracted), `REVIEWED` (human-validated). Only `REVIEWED` records are eligible for inclusion in final proposal generation. This is the core defense against hallucinated facts.
- **Stage machine on `Tender`.** The `stage` field tracks workflow progress (`TENDER_INTAKE` → analysis → matching → compliance → generation → export). Each API surface checks the stage.
- **Deterministic + AI hybrid.** Classifiers, validators, and assemblers in `lib/engine/` are deterministic; only the content-generation steps call the LLM. Validation runs *after* generation and rejects placeholders, AI traces, and fabricated facts.
- **Server-side everything.** No client-side direct DB access. All routes are server route handlers. File content is stored either in a configurable storage root (`STORAGE_ROOT`) or inline in `fileContent` fields for portability.

---

## 2. Folder structure

```
hope-tender-path-b/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Root layout, PWA manifest + SW registration
│   ├── page.tsx                      # Landing → redirects to login/dashboard
│   ├── globals.css                   # Tailwind base
│   ├── login/                        # Auth surfaces
│   ├── forgot-password/
│   ├── reset-password/
│   ├── dashboard/                    # Authenticated app shell
│   │   ├── layout.tsx                # Sidebar + nav
│   │   ├── page.tsx                  # Overview
│   │   ├── account/                  # User profile + password change
│   │   ├── users/                    # User admin (ADMIN role)
│   │   ├── setup/                    # Company setup wizard
│   │   ├── company/                  # Company knowledge vault
│   │   │   ├── documents/
│   │   │   ├── plan-b-import/        # Plan B JSON import
│   │   │   ├── review/               # Single-record review
│   │   │   └── review-board/         # Trust-level review board
│   │   ├── assets/                   # Brand assets (letterhead, logo, stamp)
│   │   ├── tenders/                  # Tender list + detail
│   │   │   ├── new/
│   │   │   └── [id]/
│   │   ├── matching/                 # Expert/project matching dashboard
│   │   ├── compliance/               # Compliance matrix + gap dashboard
│   │   ├── analysis/
│   │   ├── documents/                # Generated documents dashboard
│   │   ├── export/                   # Export package flow
│   │   ├── history/
│   │   ├── activity/
│   │   ├── settings/                 # AppSettings (branding/signature/stamp toggles)
│   │   └── system/                   # System readiness diagnostics
│   └── api/                          # 44 route handlers — see § 5
│
├── lib/                              # Server-side modules
│   ├── prisma.ts                     # Prisma singleton
│   ├── auth.ts                       # Session HMAC, login/logout helpers
│   ├── ai.ts                         # Gemini wrapper + system prompts (guardrail-aware)
│   ├── audit.ts                      # AuditLog writer
│   ├── env.ts, env-check.ts          # Env validation
│   ├── storage.ts                    # File storage abstraction
│   ├── extract-text.ts               # PDF/DOCX/XLSX → plain text
│   ├── validators.ts                 # Zod schemas
│   ├── reset-token.ts                # Password reset token signing
│   ├── system-readiness.ts           # /api/system/readiness check
│   ├── tender-workflow.ts            # Stage transitions
│   ├── login-schema-repair.ts        # Self-healing user/session schema
│   ├── company-workspace.ts          # Per-user company resolver
│   ├── company-knowledge-ai.ts       # AI-driven extract → AI_DRAFT records
│   ├── company-knowledge-import-safe.ts
│   ├── company-knowledge-safety-import.ts
│   └── engine/                       # ~30 specialist modules (see below)
│
├── lib/engine/                       # Tender engine — 46 modules
│   │
│   │ ── Core orchestration & analysis ──────────────────────────────────
│   ├── run-tender-engine.ts          # Entry point — runs analysis → matching → compliance
│   ├── analysis.ts                   # Extract requirements from tender docs
│   ├── matching.ts                   # Score experts/projects against tender
│   ├── compliance.ts                 # Build compliance matrix + gap list
│   ├── validate.ts                   # Final-output validator (placeholders, AI traces, etc.)
│   ├── documents.ts                  # GeneratedDocument CRUD helpers
│   ├── submission-plan.ts            # Required file order + naming
│   ├── tender-metadata.ts            # Per-tender derived metadata
│   ├── scope-policy.ts               # Enforces "do not generate beyond tender scope"
│   ├── proposal-intelligence.ts      # Sector detection, theme matching, evaluator criteria
│   ├── proposal-labels.ts            # Safe filename / safe heading helpers
│   ├── types.ts                      # Shared types
│   │
│   │ ── Generation ─────────────────────────────────────────────────────
│   ├── generate.ts                   # Base proposal generator
│   ├── generate-elite.ts             # Primary generator + benchmark/audit pipeline
│   ├── humanize.ts                   # Strip AI artifacts, soften LLM tone
│   │
│   │ ── Benchmark-quality tabular sections (rounds 1–6) ────────────────
│   ├── benchmark-tables.ts           # A.4, A.5, B.2, C.3, C.1.1, B.1, D.1, A.6, D.4 + openers
│   ├── understanding-and-value-added.ts # C.1, D.2, D.3, A.7, D.5
│   ├── risks-mitigations.ts          # C.5 Risk Register (sector-aware)
│   ├── why-us-summary.ts             # "Why [Company] for [Client]" 5-bullet
│   ├── work-plan-timeline.ts         # C.6 Work Plan and Schedule (sector-aware)
│   ├── bid-compliance-mapping.ts     # E.1 Tender requirements → proposal sections
│   ├── portfolio-metrics.ts          # A.0 Portfolio at a Glance metric tiles
│   ├── principal-qualifications.ts   # A.4.1 Detailed expert bios
│   │
│   │ ── Self-healing post-generation enrichers (round 4) ───────────────
│   ├── narrative-throughline-enforcer.ts # Top projects in CL/ES/B
│   ├── sector-vocabulary-enricher.ts # Inject missing sector terms
│   ├── section-reorderer.ts          # Canonical section sequence
│   ├── dynamic-toc.ts                # TOC from actual sections
│   │
│   │ ── Quality scoring & refinement (rounds 5, 11) ────────────────────
│   ├── proposal-quality-scorer.ts    # 0–100 score over 6 axes
│   │
│   │ ── Evaluator response & branding ──────────────────────────────────
│   ├── proposal-evaluator-matrix.ts  # Evaluator-criterion scoring
│   ├── proposal-benchmark-audit.ts   # Audit against winning-proposal benchmark
│   ├── proposal-benchmark-guard.ts   # Guard rails for benchmark output
│   ├── winning-proposal-benchmark.ts # Benchmark reference
│   ├── proposal-proof-density.ts     # Proof-density measurement
│   ├── proposal-strengthening-sections.ts # Evaluator-decision narrative
│   ├── proof-density-repair-guidance.ts
│   ├── benchmark-output-polisher.ts
│   ├── internal-review-stripper.ts  # Removes bid-team-only material
│   ├── apply-active-letterhead.ts    # Apply brand assets if AppSettings allow
│   ├── docx-letterhead-template.ts
│
├── components/                       # Reusable UI
│   ├── login-form.tsx
│   ├── logout-button.tsx
│   ├── nav-links.tsx
│   ├── mobile-sidebar-toggle.tsx
│   └── status-badge.tsx
│
├── prisma/
│   ├── schema.prisma                 # 17 models — see § 3
│   ├── seed.ts                       # Creates admin@hope.local / Admin123!
│   └── demo-seed.ts                  # OPTIONAL: populates the seed admin's
│                                     # company with a demo knowledge vault
│                                     # (6 reviewed experts + 6 reviewed projects)
│
├── public/
│   ├── manifest.json                 # PWA manifest
│   ├── sw.js                         # Service worker
│   ├── icon-192.png, icon-512.png    # PWA icons
│
├── electron/
│   └── main.js                       # Electron main process
│
├── electron-builder.json             # Mac dmg / Win nsis / Linux AppImage
├── docs/                             # Internal architecture notes
├── data/                             # Seed/reference data
├── scripts/check-env.mjs             # Build-time env validation
├── next.config.js                    # Server-external packages, body size, env guards
├── tailwind.config.ts
├── tsconfig.json
├── vercel.json                       # Vercel deployment config
└── .github/workflows/                # CI: Datadog synthetics
```

---

## 3. Database schema

17 Prisma models, all in `prisma/schema.prisma`. Summary:

### Identity & access
- **`User`** — id, email, passwordHash (bcrypt), role (`ADMIN` | `PROPOSAL_MANAGER`)
- **`Role`** — code/name/description (lookup table)
- **`Session`** — token, expiresAt, userId (cascade delete)

### Company workspace (one per User)
- **`Company`** — name, legalName, description, website, contact, country, `serviceLines` (JSON), `sectors` (JSON), `profileSummary`, `knowledgeMode` (default `PROFILE_FIRST`), `setupCompletedAt`. **Institutional metadata** (used by the proposal generator's D.4 Declaration, Cover Page Submitted-by/to block, A.0 Portfolio at a Glance, A.1 Company Background, A.2 Corporate Information): `gmName`, `gmTitle`, `gmLicense`, `foundingYear`, `headcount`, `licenseGrade`, `registrationNumber`, `tin`, `vat`. All institutional fields are optional — the generator falls back to generic rendering when unset.
- **`AppSettings`** — `defaultCurrency`, `aiStrictMode`, **`allowBrandingDefault`**, **`allowSignatureDefault`**, **`allowStampDefault`**, `exportFormat`, `pageNumbering`, `includeTableOfContents`, `language`. *These flags directly enforce the "do not force cover/signature/stamp if prohibited" guardrails.*
- **`CompanyDocument`** — uploaded file (PDF/DOCX/XLSX), `category`, `extractedText`, `aiExtractionStatus` (`PENDING`/`EXTRACTING`/`EXTRACTED`/`FAILED`), `aiExtractedAt`
- **`CompanyAsset`** — brand asset (letterhead, logo, stamp, signature), `assetType`, `isActive`

### Knowledge vault (trust-level enforced)
- **`Expert`** — fullName, title, contact, yearsExperience, `disciplines` (JSON), `sectors` (JSON), `certifications` (JSON), `profile`, **`trustLevel`** (`REGEX_DRAFT` | `AI_DRAFT` | `REVIEWED`), `reviewedBy`, `reviewedAt`, `sourceDocumentId`
- **`Project`** — name, clientName, country, sector, `serviceAreas`, summary, contractValue, currency, dates, **`trustLevel`** (same enum), `sourceDocumentId`
- **`ProjectEvidence`** — `evidenceType`, fileName, extractedText
- **`LegalRecord`** — `recordType`, title, authority, referenceNumber, issue/expiry dates, status
- **`FinancialRecord`** — `fiscalYear`, `recordType`, currency, amount
- **`CompanyComplianceRecord`** — `complianceType`, evidenceSummary, expiryDate

### Tender pipeline
- **`Tender`** — title, reference, clientName, category, country, budget/currency, deadline, `submissionMethod`/`submissionAddress`, `status`, **`stage`** (`TENDER_INTAKE` → ...), `intakeSummary`, `analysisSummary`, `evaluationMethodology`, `pageLimit`, **`exactFileOrder`** (JSON), **`exactFileNaming`** (JSON), `readinessScore`
- **`TenderFile`** — uploaded tender doc, `classification`, `extractedText`
- **`TenderRequirement`** — code, title, description, `requirementType`, `priority`, `sectionReference`, `requiredQuantity`, `pageLimit`, `exactFileName`, `exactOrder`, `restrictions`, `isResolved`
- **`ComplianceMatrix`** — links a `TenderRequirement` to evidence; `evidenceType`, `evidenceSource`, `evidenceReference`, `supportLevel` (`PARTIAL`/`FULL`/...)
- **`TenderExpertMatch`** / **`TenderProjectMatch`** — score (0–1), rationale, isSelected; unique on `(tenderId, expertId|projectId)`
- **`ComplianceGap`** — severity, mitigationPlan, isResolved
- **`GeneratedDocument`** — name, `documentType`, `format` (DOCX), `storagePath`, **`exactFileName`**, **`exactOrder`**, `validationStatus`, `generationStatus`, `reviewStatus`, **`reviewedExpertCount`** + **`draftExpertCount`** (transparency about source quality)
- **`ExportPackage`** — status, `fileList` (JSON), `downloadCount`

### Audit
- **`AuditLog`** — userId, action, entityType, entityId, description, metadata

---

## 4. Main workflows

### 4.1 First-time setup
1. User logs in → if no `Company`, redirected to `/dashboard/setup`
2. Setup wizard creates `Company` and seed `Expert` + `Project`
3. Optional: upload company docs → AI extracts to `AI_DRAFT` records → review board promotes to `REVIEWED`
4. Optional: upload brand assets → `CompanyAsset` rows; activate one as default letterhead
5. `Company.setupCompletedAt` set → main dashboard unlocked

### 4.2 Tender intake → ready-to-generate
```
[Tender created]
       │  POST /api/tenders  (or upload-first via /api/tenders/upload-first)
       ▼
[Files uploaded] ──── /api/upload, /api/tenders/[id]/files/[fileId]
       │
       ▼
[AI analysis] ──── POST /api/tenders/[id]/ai-analyze
       │  → extracts TenderRequirement rows, evaluationMethodology, pageLimit,
       │    exactFileOrder, exactFileNaming, submission rules
       ▼
[Matching] ──── POST /api/tenders/[id]/matches
       │  → scores REVIEWED Experts and Projects against requirements
       ▼
[Compliance] ──── ComplianceMatrix + ComplianceGap auto-built
       │
       ▼
[Generate] ──── POST /api/tenders/[id]/generate or /ai-proposal
       │  → runs lib/engine/run-tender-engine → produces GeneratedDocument rows
       ▼
[Validate] ──── POST /api/tenders/[id]/validate
       │  → lib/engine/validate.ts checks for placeholders, AI traces,
       │    fabricated claims, prohibited content, page-limit violations
       ▼
[Export] ──── POST /api/tenders/[id]/export → ExportPackage
       │
       ▼
[Download ZIP] ─── GET /api/tenders/[id]/download
       │  → exact file order + exact file naming applied
```

### 4.3 Knowledge promotion (REGEX_DRAFT/AI_DRAFT → REVIEWED)
- Records arrive via document import (regex pass + Gemini extraction)
- Review board (`/dashboard/company/review-board`) shows all draft records
- Reviewer toggles `trustLevel` to `REVIEWED`
- Generation pipeline only consumes `REVIEWED` records (or counts drafts and warns; see `GeneratedDocument.draftExpertCount`)

### 4.4 Brand-asset application
- Generation respects `AppSettings.allowBrandingDefault` / `allowSignatureDefault` / `allowStampDefault`
- Per-tender override possible via `Tender.notes` / `TenderRequirement.restrictions`
- `lib/engine/apply-active-letterhead.ts` only stamps a letterhead if the **tender does not prohibit it** AND `AppSettings` permits

---

## 5. API design

44 route handlers under `app/api/`. All return JSON. All mutating routes require an authenticated session via the `auth.ts` middleware (in-route session check).

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Email + password → set session cookie |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/auth/me` | Current user + role |
| POST | `/api/auth/forgot-password` | Issue reset token (email if SMTP configured, else logged) |
| POST | `/api/auth/reset-password` | Consume token, update password |

### Users (admin)
| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/users` | List / create user |
| GET / PATCH / DELETE | `/api/users/[id]` | Manage user |

### Company workspace
| Method | Path | Purpose |
|---|---|---|
| GET / PATCH | `/api/company` | Get/update company profile |
| GET / POST | `/api/company/documents` | List / upload docs |
| DELETE | `/api/company/documents/[id]` | Remove doc |
| GET / POST | `/api/company/assets` | Brand assets |
| DELETE | `/api/company/assets/[id]` | Remove asset |
| GET / POST | `/api/company/experts` | Experts CRUD |
| PATCH / DELETE | `/api/company/experts/[id]` | Including trust-level promotion |
| GET / POST | `/api/company/projects` | Projects CRUD |
| PATCH / DELETE | `/api/company/projects/[id]` | Including trust-level promotion |
| POST | `/api/company/plan-b-import` | Bulk JSON import |
| POST | `/api/company/reimport` | Re-extract from existing docs |
| POST | `/api/company/cleanup-support-imports` | Drop orphaned drafts |
| POST | `/api/company/knowledge/repair` | Self-heal data inconsistencies |
| GET | `/api/company/review-summary` | Counts of REVIEWED vs DRAFT |

### Tenders
| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/tenders` | List / create |
| GET / PATCH / DELETE | `/api/tenders/[id]` | Detail / update / delete |
| POST | `/api/tenders/upload-first` | Create-then-attach in one call |
| POST | `/api/tenders/[id]/duplicate` | Clone |
| POST | `/api/tenders/[id]/ai-analyze` | Extract requirements via Gemini |
| POST | `/api/tenders/[id]/engine` | Run full engine cycle |
| POST | `/api/tenders/[id]/matches` | Score experts + projects |
| POST | `/api/tenders/[id]/ai-proposal` | Generate proposal narrative |
| POST | `/api/tenders/[id]/generate` | Generate full document set |
| POST | `/api/tenders/[id]/validate` | Run validation pipeline |
| POST | `/api/tenders/[id]/export` | Build ExportPackage |
| GET | `/api/tenders/[id]/download` | Download ZIP |
| GET / DELETE | `/api/tenders/[id]/files/[fileId]` | Tender file ops |
| GET / DELETE | `/api/tenders/[id]/documents/[docId]` | Generated doc ops |
| PATCH | `/api/tenders/[id]/gaps/[gapId]` | Resolve compliance gap |

### Documents & uploads
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/documents` | All generated documents (across tenders) |
| POST | `/api/upload` | Generic file upload |

### System
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/system/readiness` | Env + DB + AI key validation |
| GET / PATCH | `/api/settings` | AppSettings |
| GET | `/api/audit` | Audit log feed |
| POST | `/api/admin/diagnostics` | Detailed diagnostics dump |
| POST | `/api/admin/repair` | Schema/data repair |

---

## 6. UI page and component structure

### Top-level layout
- `app/layout.tsx` — root HTML, PWA manifest, service worker registration, Apple meta tags
- `app/dashboard/layout.tsx` — sidebar nav + responsive shell

### Dashboards
| Path | Component | Purpose |
|---|---|---|
| `/dashboard` | `app/dashboard/page.tsx` | Overview |
| `/dashboard/setup` | wizard | First-run company setup |
| `/dashboard/company` | knowledge vault | Profile + docs + experts + projects + legal/financial/compliance |
| `/dashboard/company/review-board` | review queue | Promote DRAFT → REVIEWED |
| `/dashboard/assets` | brand asset manager | Upload/activate letterhead/logo/stamp/signature |
| `/dashboard/tenders` | tender list | Search + filter |
| `/dashboard/tenders/new` | upload form | Upload-first creation |
| `/dashboard/tenders/[id]` | tender detail | Full workflow surface (editable summary, file list, requirements, generated docs) |
| `/dashboard/matching` | matching dashboard | Cross-tender matching view |
| `/dashboard/compliance` | compliance matrix | Gap resolution |
| `/dashboard/analysis` | analysis | AI-extracted summaries |
| `/dashboard/documents` | generated documents | All `GeneratedDocument` rows |
| `/dashboard/export` | export queue | Per-tender export packages |
| `/dashboard/history` | history | Past tenders + searchable archive |
| `/dashboard/activity` | activity feed | Audit log surface |
| `/dashboard/settings` | AppSettings | Branding/signature/stamp toggles, currency, language |
| `/dashboard/system` | system check | Live readiness against `/api/system/readiness` |
| `/dashboard/users` | user admin | ADMIN-only |
| `/dashboard/account` | profile | Self-service |

### Reusable components
| Component | Purpose |
|---|---|
| `components/login-form.tsx` | Email + password client form |
| `components/logout-button.tsx` | Logout action |
| `components/nav-links.tsx` | Sidebar nav with active-route highlight |
| `components/mobile-sidebar-toggle.tsx` | Mobile drawer trigger |
| `components/status-badge.tsx` | Status pill (used across tender / compliance / generation states) |

---

## 7. Environment variables

Source of truth: `.env.example`. Build-time validation: `scripts/check-env.mjs` (runs before `next build`).

```env
# ── Required (fails build / startup if missing or invalid) ──────────────────

# PostgreSQL connection string (Neon, Supabase, Railway, RDS, etc.)
# Must start with postgresql:// or postgres://
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"

# HMAC session signing secret. Generate with: openssl rand -hex 32
# Must be ≥32 chars, must not be a known insecure default.
SESSION_SECRET="<64-character random hex>"

# ── AI providers — set at least one key ─────────────────────────────────────
# The single source of truth for the canonical automatic provider order is
# lib/ai-provider-registry.ts. The order is:
#   Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/Claude
# The first five are the currently-working providers. Anthropic/Claude is the
# last-resort (emergency-only) provider. See docs/ai-provider-order.md.
#
# Vercel Hobby: at most 3 ACTUAL outbound provider attempts per request/chunk;
# unconfigured/cooled-down/invalid-OpenRouter providers are skipped for free.

# Z.ai GLM — first-tier, general OpenAI-compatible endpoint (NOT a Coding Plan).
# ZAI_API_KEY="..."           # ZAI_BASE_URL default https://api.z.ai/api/paas/v4, model glm-4.7-flash

# Cerebras — second-tier, OpenAI-compatible (uses max_completion_tokens).
# CEREBRAS_API_KEY="..."      # default model gpt-oss-120b

# Mistral / Groq — third & fourth tier (currently-working).
# MISTRAL_API_KEY="..."
# GROQ_API_KEY="gsk_..."

# OpenRouter — fifth tier. MUST be an explicit ':free' model; 'openrouter/auto'
# and any non-':free' model are rejected to prevent paid usage.
# OPENROUTER_API_KEY="sk-or-..."
# OPENROUTER_PROPOSAL_MODEL="meta-llama/llama-3.3-70b-instruct:free"

# Remaining supported providers (after OpenRouter, in order):
# GEMINI_API_KEY="AIza..."    # AIza + 35 alphanumerics (39 chars total)
# OPENAI_API_KEY="sk-..."
# TOGETHER_API_KEY="..."
# DEEPSEEK_API_KEY="..."
# ANTHROPIC_API_KEY="sk-ant-..."  # last-resort, emergency-only

# ── Optional ────────────────────────────────────────────────────────────────

# Override default Gemini model (default: gemini-2.5-pro)
# GEMINI_MODEL="gemini-2.0-flash"

# Override extraction-only model (CV / project parsing)
# GEMINI_EXTRACT_MODEL="gemini-2.0-flash"

# Local file storage root (default: ./.storage)
# STORAGE_ROOT="./.storage"

# Vercel Blob token (only if using Vercel Blob for files)
# BLOB_READ_WRITE_TOKEN=""
```

The validator (`scripts/check-env.mjs`) rejects:
- A `DATABASE_URL` that isn't `postgresql://` / `postgres://` (SQLite is **not supported** in production)
- A `SESSION_SECRET` shorter than 32 chars or matching a known placeholder
- A `GEMINI_API_KEY` that doesn't start with `AIza` (catches accidentally-pasted Anthropic / OpenAI keys)
- An `ANTHROPIC_API_KEY` that doesn't start with `sk-ant-` or is unreasonably short (catches accidentally-pasted Gemini / OpenAI keys)

---

## 8. Setup, run, deploy

### Prerequisites
- Node.js 20+
- A PostgreSQL database (Neon free tier works)
- An AI provider key — at least one from the canonical chain (Z.ai GLM, Cerebras, Mistral, Groq, OpenRouter, Gemini, OpenAI, Together, DeepSeek, or Anthropic/Claude). See docs/ai-provider-order.md.

### Local development
```bash
git clone https://github.com/hopeengineering83-code/hope-tender-path-b.git
cd hope-tender-path-b
cp .env.example .env.local       # then edit with real values
npm install                      # also runs `prisma generate`
npx prisma migrate deploy        # apply schema
npm run db:seed                  # creates admin@hope.local / Admin123!
npm run db:demo-seed             # OPTIONAL — populates the seed admin's
                                 # company with a demo knowledge vault
                                 # (6 reviewed experts + 6 reviewed
                                 # projects) so the proposal generator
                                 # can be tested immediately
npm run dev                      # http://localhost:3000
```

Login with the seeded credentials, change the password immediately on first run.

### Build
```bash
npm run build                    # check-env → prisma generate → next build
npm run start                    # production server
```

### Deploy to Vercel
1. Push to a GitHub repo connected to Vercel
2. Set env vars in Vercel → Settings → Environment Variables: `DATABASE_URL`, `SESSION_SECRET`, `GEMINI_API_KEY`
3. Build command stays `npm run build`. The `check-env.mjs` step will fail the build with a readable error if any required var is missing.
4. After first deploy, run migrations: `npx prisma migrate deploy` against the production database, then optionally seed.

### Datadog synthetics CI
`.github/workflows/datadog-synthetics.yml` runs synthetic browser tests against the deployed URL. Configure `DD_API_KEY`, `DD_APP_KEY`, and `DD_SYNTHETICS_TEST_ID` as repo secrets to enable.

---

## 9. PWA installation (mobile + desktop browser)

The app is already installable. No additional code is required to enable PWA:

- `public/manifest.json` declares name, icons (192, 512), `start_url=/dashboard`, `display: standalone`, theme/background colors, and shortcuts ("New Tender", "Dashboard")
- `public/sw.js` is a network-first cache for static assets; **skips `/api/*` routes** (so authenticated/dynamic data is never staled)
- `app/layout.tsx` registers the service worker on `window.load` and emits Apple `mobile-web-app-capable` meta tags

### What users see
- **Android Chrome / Edge:** automatic "Add to Home Screen" prompt after engagement
- **iOS Safari:** Share → "Add to Home Screen" (manual; iOS doesn't auto-prompt)
- **Desktop Chrome / Edge:** install icon in address bar
- **Standalone window:** opens at `/dashboard`, no browser chrome

### To verify locally
```bash
npm run build && npm run start
# Open http://localhost:3000 → Chrome DevTools → Application tab → Manifest + Service Workers
```

### To extend (optional improvements you may want later)
- Add offline fallback page (`/offline`) and route `event.respondWith` in `sw.js` to serve it on network failure
- Pre-cache critical CSS/JS bundles by reading the `_next/static` manifest
- Add periodic background sync for tender list refresh (requires HTTPS)

These are *enhancements*, not requirements — the current implementation already passes Lighthouse PWA audit.

---

## 10. Desktop packaging (Electron)

The desktop wrapper is already configured. To build a distributable:

```bash
# 1. Build the Next.js app first (Electron embeds the production server)
npm run build

# 2. Add Electron + electron-builder as devDependencies (one-time)
npm install --save-dev electron electron-builder

# 3. Run in dev (loads http://localhost:3000)
npx next start &           # in one shell
npx electron .             # in another

# 4. Build distributables
npx electron-builder --config electron-builder.json --mac --win --linux
# Outputs to dist-electron/
```

### What's already configured
- **`electron-builder.json`** — appId `com.hopeengineering.tender-generator`, targets:
  - Mac: dmg (x64 + arm64), business category
  - Windows: NSIS installer with desktop + Start menu shortcuts, user can pick install dir
  - Linux: AppImage, "Office" category
- **`electron/main.js`** — single `BrowserWindow` (1400×900, min 900×600), spawns Next.js server on port 3000, loads in-window. Native menu integration on macOS via `titleBarStyle: hiddenInset`.
- **App icon:** `public/icon-512.png`

### Important runtime considerations
- The Electron main process **spawns** `next start` as a child — you'll want to add a graceful shutdown so the server is killed when the window closes (see `electron/main.js` and add a `before-quit` handler if not already present).
- Database: bundled apps still need a `DATABASE_URL`. For a single-user offline desktop, you would need to either (a) ship with a hosted Postgres (URL baked in or prompted on first run) or (b) replace Postgres with SQLite (requires a Prisma datasource swap and re-running `prisma generate` — Prisma supports both, but the schema uses `String` types that map fine to SQLite).
- AI calls still go to Gemini over the network — no offline AI.

### Tauri alternative (if Electron bundle size is a concern)
Tauri ships a smaller binary by reusing the OS webview. To switch:
1. `cargo install tauri-cli` and `npm install --save-dev @tauri-apps/cli`
2. Replace `electron/` with `src-tauri/` (Rust shell)
3. Point Tauri's `tauri.conf.json` `devPath` at `http://localhost:3000` and `distDir` at the built Next.js output (you'll need to export to a static-compatible adapter, OR run `next start` as a sidecar — Tauri supports both)
4. Reuse `public/icon-512.png`

Tauri is more involved than Electron because the Next.js server must run alongside the webview — for this app, **Electron is the recommended path**.

---

## 11. Guardrails enforced in code

The user-stated guardrails map directly to existing code:

| Guardrail | Enforced by |
|---|---|
| Do not invent data | `Expert.trustLevel` / `Project.trustLevel` enum + filter in `lib/engine/run-tender-engine.ts`; only `REVIEWED` flows to final |
| Do not generate beyond tender scope | `lib/engine/scope-policy.ts` |
| Do not leave placeholders | `lib/engine/validate.ts` `PLACEHOLDER_PATTERNS` + `BLOCK`-severity issue `PLACEHOLDER_IN_DOCUMENT` |
| Do not expose AI traces | `lib/engine/internal-review-stripper.ts`; `lib/engine/proposal-benchmark-guard.ts`; `lib/engine/humanize.ts` rewrites |
| Do not force cover pages if prohibited | `AppSettings.allowBrandingDefault` + per-tender override; `lib/engine/apply-active-letterhead.ts` checks before applying |
| Do not force signature/stamp if prohibited | `AppSettings.allowSignatureDefault` / `allowStampDefault` checked at generation |
| Do not use unsupported company facts | trust-level system; `GeneratedDocument.draftExpertCount` records every draft source used so reviewers can audit |
| Do not return only summaries / concepts | `lib/engine/generate-elite.ts` produces full sectioned output (markdown → DOCX), not summaries |
| Do not stop at architecture diagrams | Generator outputs DOCX files matching `Tender.exactFileNaming` and `exactFileOrder` — actual deliverables |
| Do not leave core features as TODOs | No `TODO` / `FIXME` / `XXX` markers in code (grepped) |
| Do not produce a demo-only shell | Full database, full auth, full audit log, full export pipeline — see `prisma/schema.prisma` |

---

## 12. Generation pipeline — sections produced

The proposal generator produces a structured document in canonical order, regardless of whether the AI step succeeded, partially succeeded, or fell back to deterministic generation. Each section below is appended only when no equivalent heading exists in the upstream output (idempotent, no duplicates).

### Pipeline order

```
1. AI / fallback first draft        (lib/engine/generate-elite.ts → AI prompt or fallbackProposalMarkdown)
2. Evaluator response matrix        (lib/engine/proposal-evaluator-matrix.ts)
3. Strengthening sections           (lib/engine/proposal-strengthening-sections.ts)
4. Benchmark tables                 (lib/engine/benchmark-tables.ts)
5. Round-2 / 4 / 5 / 6 sections     (the modules listed below)
6. Throughline enforcer             (lib/engine/narrative-throughline-enforcer.ts)
7. Sector vocabulary enricher       (lib/engine/sector-vocabulary-enricher.ts)
8. Canonical section reorderer      (lib/engine/section-reorderer.ts)
9. Dynamic Table of Contents        (lib/engine/dynamic-toc.ts)
10. finalizeClientReadyProposalMarkdown / cleanClientLanguage
11. Quality scorer                  (lib/engine/proposal-quality-scorer.ts)
12. Multi-pass refinement (cond.)   (lib/ai.ts → refineProposalWithAI, only if score < 70)
13. DOCX render                     (docx package, lib/engine/apply-active-letterhead)
```

### Sections in the rendered DOCX (canonical order)

| Section | Source module |
|---|---|
| Cover Letter (project-anchored opening) | fallbackProposalMarkdown / `buildCoverLetterOpener` |
| Cover Page (Submitted-by/to metadata table) | `buildSubmittedByToBlock` |
| Table of Contents (dynamic, from actual sections) | `dynamic-toc.ts` |
| Executive Summary ("[Company] has already delivered…") | `buildExecutiveSummaryOpener` |
| Why [Company] for [Client] (5 evidence-anchored bullets) | `why-us-summary.ts` |
| A.0 Portfolio at a Glance (metric tiles) | `portfolio-metrics.ts` |
| A.1 Company Background | AI / fallback |
| A.2 Corporate Information (TIN, VAT, license, founding year, headcount) | AI / fallback (uses Round-10 fields) |
| A.4 Proposed Project Team (table) | `benchmark-tables.ts → buildProposedTeamTable` |
| A.4.1 Principal Qualifications — Detailed Bios | `principal-qualifications.ts` |
| A.5 Team-to-Project Experience Mapping | `benchmark-tables.ts → buildTeamToProjectMappingTable` |
| A.6 Specialist Engagement Plan (conditional) | `benchmark-tables.ts → buildSpecialistEngagementSection` |
| A.7 In-House Capabilities | `understanding-and-value-added.ts → buildInHouseCapabilitiesSection` |
| B.1 Client References (table) | `benchmark-tables.ts → buildClientReferencesTable` |
| B.2.0 Portfolio Reading Guide | `benchmark-tables.ts → buildPortfolioReadingGuide` |
| B.2 Project Portfolio Cards | `benchmark-tables.ts → buildProjectPortfolioCards` |
| C.1 Understanding of the Assignment | `understanding-and-value-added.ts → buildUnderstandingSection` |
| C.1.1 Weighted Assessment Matrix (conditional) | `benchmark-tables.ts → buildAssessmentMatrix` |
| C.2 Technical Methodology | AI / fallback (sector-aware via `proposal-intelligence.ts` themes) |
| C.3 Three-Stage Quality Review | `benchmark-tables.ts → buildThreeStageReviewTable` |
| C.4 Sector-Specific Technical Standards | `sector-vocabulary-enricher.ts` (only when terms missing) |
| C.5 Risk Register and Mitigation Strategy | `risks-mitigations.ts` |
| C.6 Work Plan and Schedule | `work-plan-timeline.ts` |
| D.1 Value Framework — What [Client] Gains | `benchmark-tables.ts → buildValueFrameworkTable` |
| D.2 Value-Added Services | `understanding-and-value-added.ts → buildValueAddedServices` |
| D.3 Professional Certifications and Affiliations | `understanding-and-value-added.ts → buildCertificationsSection` |
| D.4 Declaration of Eligibility (uses `Company.gmName` + `Company.gmLicense` when set) | `benchmark-tables.ts → buildDeclaration` |
| D.5 Declaration of No Conflict of Interest | `understanding-and-value-added.ts → buildConflictOfInterestSection` |
| E.1 Bid Compliance Mapping | `bid-compliance-mapping.ts` |
| Submission Control Sheet | fallbackProposalMarkdown |

### Quality scoring

After rendering, `proposal-quality-scorer.ts` produces a 0–100 score over six axes:

1. **structureCompleteness** — presence of canonical sections
2. **evidenceDensity** — fraction of substantive paragraphs with specific evidence (project name, ETB value, license number, donor reference)
3. **tableCoverage** — count of distinct table-style sections present
4. **sectorVocabulary** — fraction of expected sector terms present
5. **throughlineConsistency** — top 1–2 projects appearing in Cover Letter, Executive Summary, AND Section B
6. **aiTraceFreedom** — absence of forbidden phrases ("As an AI", "[INSERT]", etc.)

The score plus the weak-axis list is embedded in `GeneratedDocument.contentSummary`. If the score is below 70 and an AI provider is configured, the proposal is sent for one targeted refinement pass via `refineProposalWithAI`; the refined output is adopted only if its score is strictly higher (idempotent — never weakens the proposal).

### Idempotency guarantees

- All round-1–13 enrichers gate on `makeHasHeadingChecker` so they never duplicate AI-produced equivalents.
- The throughline enforcer only inserts "Comparable reference anchor" sentences for projects not already named in a target section.
- The vocabulary enricher only emits the standards section when fewer than 70 % of expected sector terms are present.
- The section reorderer never deletes content; only reorders top-level sections.
- The refinement pass keeps all tables and factual claims intact, rewrites only prose.

---

## License & ownership

Proprietary — Copyright © 2025 Hope Urban Planning Architectural and Engineering Consultancy. See `electron-builder.json` for product metadata.
