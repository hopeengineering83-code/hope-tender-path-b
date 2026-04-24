# Hope Tender Proposal Generator

Production-oriented tender operating system for Hope Urban Planning Architectural and Engineering Consultancy.

## What this app does

The app stores reusable company knowledge once, analyzes each tender from uploaded tender files, maps requirements against company evidence, selects only the tender-required experts and project references, detects compliance gaps, generates tender-required documents, validates final scope, and prepares export packages.

## Current Phase 1 modules

- Authentication foundation with role-aware protected access.
- Company setup and knowledge vault.
- Company document, asset, expert, project, legal, financial, and compliance record foundations.
- Tender intake with file upload and text extraction pipeline.
- Tender analysis engine for requirement, file naming, and ordering extraction.
- Matching engine with strict exact-quantity selection.
- Compliance engine with evidence mapping and gap detection.
- Strict document planning and generation pipeline.
- Humanization and validation foundations.
- Generated document, export, history, user, activity, and settings pages.
- PWA manifest and service worker for installable mobile use.

## Strict tender-scope rule

The engine is designed around one rule: generate exactly and only what the tender requires.

The strict scope policy is implemented in `lib/engine/scope-policy.ts` and is used by matching, compliance, document planning, and generation. It prevents automatic expert/project selection when a required quantity is not extracted, avoids forced technical proposals, honors branding and cover-page restrictions, and normalizes tender-required file names.

## Tech stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL-ready Prisma schema
- DOCX generation with `docx`
- ZIP packaging with `jszip`
- Document extraction with PDF/DOCX/XLSX-ready packages

## Environment variables

Copy `.env.example` to `.env` and set values:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
SESSION_SECRET="replace-this-with-a-long-random-secret"
STORAGE_ROOT="./.storage"
BLOB_READ_WRITE_TOKEN=""
```

## Local development

```bash
npm install
npm run db:seed
npm run dev
```

## Production build

```bash
npm run build
npm run start
```

The build script runs Prisma database push and client generation before `next build`.

## PWA support

The app includes:

- `public/manifest.json`
- `public/sw.js`
- manifest and service worker registration in `app/layout.tsx`

The service worker caches navigation shell pages and skips API/export/download routes so document-heavy operations remain server-authoritative.

## Desktop packaging preparation

The codebase is structured as a shared Next.js app. To package later with Tauri or Electron:

1. Build the web app with `npm run build`.
2. Add a desktop shell under `desktop/`.
3. Point the shell to the Next.js server or exported web bundle depending on deployment strategy.
4. Keep document generation and storage on the server side for secure file handling.

## Guardrails

- Company documents remain the factual source.
- Tender documents define what is generated.
- Missing exact quantities create compliance review gaps instead of guessed selections.
- Final generation blocks on unresolved high/critical compliance gaps.
- AI traces and placeholders are checked during validation.
- Branding, cover pages, signatures, and stamps are applied only when allowed or required.
