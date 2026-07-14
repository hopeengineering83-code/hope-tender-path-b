# Quickstart

Get the Hope Tender Engine running locally in 5 minutes. For the full
reference, see [README.md](./README.md).

## Prerequisites

- **Node.js 22** (check with `node --version`)
- **PostgreSQL 16+** — use [Neon free tier](https://neon.tech),
  [Supabase](https://supabase.com), or a local install
- **At least one AI provider API key** — see [provider chain](./.env.example)
  for the 10 options (Z.ai, Cerebras, Mistral, Groq, OpenRouter, Gemini,
  OpenAI, Together, DeepSeek, Anthropic)

## Setup (5 minutes)

```bash
# 1. Clone and install
git clone https://github.com/hopeengineering83-code/hope-tender-path-b.git
cd hope-tender-path-b
npm install              # also runs `prisma generate` via postinstall

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with:
#   DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
#   SESSION_SECRET="<run: openssl rand -hex 32>"
#   GEMINI_API_KEY="AIza..." (or any other provider key)

# 3. Apply database migrations
npx prisma migrate deploy

# 4. Create admin user
npm run db:seed           # creates admin@hope.local / Admin123!
                          # CHANGE THIS PASSWORD IMMEDIATELY after first login

# 5. (Optional) Load demo knowledge vault
npm run db:demo-seed      # adds 6 reviewed experts + 6 reviewed projects
                          # so proposal generation can be tested immediately

# 6. Start the dev server
npm run dev               # http://localhost:3000
```

## First login

1. Open http://localhost:3000
2. Login with `admin@hope.local` / `Admin123!`
3. **Change your password immediately** at `/dashboard/account`
4. Complete company setup at `/dashboard/setup`
5. (Optional) Upload brand assets at `/dashboard/company`
6. Create your first tender at `/dashboard/tenders/new`

## First tender workflow

1. **Upload tender document** (PDF, DOCX, or XLSX) —
   the app extracts text and metadata automatically.
2. **Run AI Analyze** — extracts requirements, evaluation criteria,
   submission rules, client details. Verify the extracted data; edit if
   needed.
3. **Build submission plan** — maps requirements to required documents.
4. **Generate documents** — AI generates cover letter, technical
   methodology, compliance matrix, risk register, work plan.
5. **Review and validate** — check for placeholders, AI traces, factual
   errors.
6. **Export final ZIP** — byte-integrity-verified ZIP with exact file
   naming and order matching the tender's requirements.

## Common issues

| Symptom | Fix |
|---|---|
| `prisma migrate deploy` fails with connection error | Verify `DATABASE_URL` is correct and DB is reachable |
| Build fails with "AI provider not configured" | Set at least one `*_API_KEY` in `.env.local` |
| `npm run dev` crashes on startup | Check `SESSION_SECRET` is set and ≥ 32 chars |
| AI Analyze hangs | Check provider API key validity; check `ProviderHealthSnapshot` table |
| Login fails after seeding | Ensure `db:seed` ran successfully; check `User` table |

## Production deployment

See [README.md § 8](./README.md#8-setup-run-deploy) for Vercel deployment
instructions.

## Where to go next

- [Full README](./README.md) — complete reference
- [docs/audits/](./docs/audits/) — historical audit reports
- [docs/runbooks/](./docs/runbooks/) — incident response and SLO docs
- [docs/adr/](./docs/adr/) — architecture decision records
- [CLAUDE.md](./CLAUDE.md) + [AGENTS.md](./AGENTS.md) + [operator_handoff.md](./operator_handoff.md) — agent coordination
