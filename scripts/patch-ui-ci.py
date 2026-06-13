from pathlib import Path

root = Path(__file__).resolve().parents[1]

page_path = root / "app/dashboard/tenders/[id]/page.tsx"
page = page_path.read_text(encoding="utf-8")
page = page.replace('import { LegacyTenderActionHider } from "../../../../components/legacy-tender-action-hider";\n', '')
page = page.replace('(tender as Record<string, unknown>).procuringEntityName as string | null | undefined', 'tender.procuringEntityName')
legacy = '''      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <span className="font-semibold">Authoritative actions:</span> use the Final Submission Control Center and structured panels above. Only the duplicate legacy buttons are hidden below; other actions remain available.
      </div>
      <div id="legacy-tender-detail-actions">
        <LegacyTenderActionHider targetId="legacy-tender-detail-actions" />
        <TenderDetail tender={tenderForUi} aiEnabled={ai} canonicalReadiness={canonicalReadiness} />
      </div>'''
if page.count(legacy) != 1:
    raise RuntimeError(f"legacy tender page block: expected one match, found {page.count(legacy)}")
page = page.replace(legacy, '      <TenderDetail tender={tenderForUi} aiEnabled={ai} canonicalReadiness={canonicalReadiness} />')
page_path.write_text(page, encoding="utf-8")
(root / "components/legacy-tender-action-hider.tsx").unlink(missing_ok=True)

ci = '''name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    name: Typecheck, lint, test, e2e, and build
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test (unit)
        run: npm test

      - name: Install Playwright browser
        run: npx playwright install --with-deps chromium

      - name: Start application for E2E
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL || 'postgresql://ci:ci@127.0.0.1:5432/ci' }}
          SESSION_SECRET: ${{ secrets.SESSION_SECRET || 'ci-e2e-placeholder-not-used-at-runtime-abcdef0123456789' }}
          NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET || 'ci-nextauth-placeholder' }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY || 'AIzaFakeCiE2EKeyNotUsedAtRuntime12345678901' }}
        run: npm run dev -- --hostname 127.0.0.1 > /tmp/hope-e2e.log 2>&1 &

      - name: Test (Playwright smoke)
        env:
          PLAYWRIGHT_BASE_URL: http://127.0.0.1:3000
        run: npx --yes wait-on http://127.0.0.1:3000/login && npm run test:e2e

      - name: Build
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL || 'postgresql://ci:ci@127.0.0.1:5432/ci' }}
          SESSION_SECRET: ${{ secrets.SESSION_SECRET || 'ci-build-only-placeholder-not-used-at-runtime-abcdef0123456789' }}
          NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET || 'ci-nextauth-placeholder' }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY || 'AIzaFakeCiBuildKeyNotUsedAtRuntime12345678901' }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: npm run build
'''
(root / ".github/workflows/ci.yml").write_text(ci, encoding="utf-8")
print("Removed legacy duplicate-action hider and strengthened CI")
