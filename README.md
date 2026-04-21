# Hope Tender Proposal Generator

A workflow-driven tender engine for **Hope Urban Planning Architectural and Engineering Consultancy**.

## What this branch now supports

- reusable company knowledge vault
- company document uploads
- expert library and project reference library
- tender intake with richer metadata
- tender file uploads
- tender engine run
- structured requirement creation
- expert and project matching
- compliance gap detection
- generated document planning
- DOCX generation for planned outputs
- ZIP export package preparation
- activity logging for core workflow actions

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- docx
- jszip

## Environment

Copy `.env.example` to `.env` and set values:

- `DATABASE_URL`
- `SESSION_SECRET`
- `STORAGE_ROOT`

## Local setup

```bash
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

## Seed login

The seed user is created from environment variables if provided:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`

Otherwise it falls back to defaults defined in `prisma/seed.ts`.

## Tender workflow

1. Go to **Company Knowledge Vault** and save company profile data.
2. Upload company documents.
3. Add expert records.
4. Add project reference records.
5. Create a new tender from **Tenders**.
6. Upload tender files in the tender workspace.
7. Click **Run Tender Engine**.
8. Review requirements, matching, and compliance.
9. Click **Generate Documents**.
10. Click **Prepare Export**.

## Deployment notes

For Vercel or similar hosting:

- provision PostgreSQL first
- set `DATABASE_URL`
- set `SESSION_SECRET`
- set `STORAGE_ROOT` if needed
- ensure the database schema is pushed before first production use

Recommended deployment sequence:

```bash
npx prisma db push
npm run build
```

## Current scope

This branch now provides a working tender-engine foundation.

Still recommended for next phase:

- deeper PDF and DOCX parsing
- evidence excerpt traceability
- stronger matching scoring loops
- richer review and approval workflow
- actual downloadable file endpoints
- blob/object storage for durable cloud file persistence
- final submission validation rules by tender template
