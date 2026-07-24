#!/usr/bin/env bash
set -euo pipefail

: > /tmp/applied-groups.txt
: > /tmp/skipped-groups.txt

git show origin/pr-1249:app/dashboard/compliance/compliance-dashboard.tsx \
  > app/dashboard/compliance/compliance-dashboard.tsx
echo "PR #1249 — compliance mobile overflow fixes" >> /tmp/applied-groups.txt

python - <<'PY'
from pathlib import Path
import re

path = Path("app/dashboard/company/review/page.tsx")
source = path.read_text()

for old, new in [
    (
        'className="rounded-lg border px-3 py-1.5 disabled:opacity-50"\n          aria-label="Previous page"',
        'className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"\n          aria-label="Previous page"\n          title={props.page <= 1 ? "You are on the first page." : "Go to the previous page."}',
    ),
    (
        'className="rounded-lg border px-3 py-1.5 disabled:opacity-50"\n          aria-label="Next page"',
        'className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"\n          aria-label="Next page"\n          title={props.page >= props.totalPages ? "You are on the last page." : "Go to the next page."}',
    ),
]:
    if source.count(old) != 1:
        raise SystemExit(f"Expected one pagination pattern, found {source.count(old)}")
    source = source.replace(old, new)

expert_pattern = re.compile(
    r'          <div className="flex flex-wrap gap-2">\s*'
    r'<button type="button" onClick=\{\(\) => setSelectedExperts[\s\S]*?'
    r'<button type="button" onClick=\{\(\) => void submitBatch\("experts"\)\}[\s\S]*?'
    r'          </div>'
)
expert_replacement = '''          <div className="flex flex-wrap items-center gap-2">
            {eligibleExperts.length === 0 && (
              <span className="text-[11px] font-medium text-amber-800">
                {expertItems.length === 0
                  ? "No expert records are available. Upload Company Vault sources; ingestion and source verification run automatically."
                  : "No experts on this page are eligible for human review. Open Evidence status for the exact source blocker."}
              </span>
            )}
            <button type="button" onClick={() => setSelectedExperts(new Set(eligibleExperts.map((item) => item.id)))} disabled={eligibleExperts.length === 0} className="rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50" title={eligibleExperts.length === 0 ? "No source-verified experts on this page are eligible for human review." : "Select every eligible expert on this page."}>Select eligible on page</button>
            <button type="button" onClick={() => void submitBatch("experts")} disabled={selectedExperts.size === 0 || batchingExperts} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50" title={selectedExperts.size === 0 ? "Select at least one source-verified expert." : "Human-review the selected experts against their durable source evidence."}>
              {batchingExperts ? "Reviewing…" : `Human-review selected (${selectedExperts.size})`}
            </button>
          </div>'''
source, count = expert_pattern.subn(expert_replacement, source, count=1)
if count != 1:
    raise SystemExit(f"Expected one expert action block, found {count}")

project_pattern = re.compile(
    r'          <div className="flex flex-wrap gap-2">\s*'
    r'<button type="button" onClick=\{\(\) => setSelectedProjects[\s\S]*?'
    r'<button type="button" onClick=\{\(\) => void submitBatch\("projects"\)\}[\s\S]*?'
    r'          </div>'
)
project_replacement = '''          <div className="flex flex-wrap items-center gap-2">
            {eligibleProjects.length === 0 && (
              <span className="text-[11px] font-medium text-amber-800">
                {projectItems.length === 0
                  ? "No project records are available. Upload Company Vault sources; ingestion and source verification run automatically."
                  : "No projects on this page are eligible for human review. Open Evidence status for the exact source blocker."}
              </span>
            )}
            <button type="button" onClick={() => setSelectedProjects(new Set(eligibleProjects.map((item) => item.id)))} disabled={eligibleProjects.length === 0} className="rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50" title={eligibleProjects.length === 0 ? "No source-verified projects on this page are eligible for human review." : "Select every eligible project on this page."}>Select eligible on page</button>
            <button type="button" onClick={() => void submitBatch("projects")} disabled={selectedProjects.size === 0 || batchingProjects} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50" title={selectedProjects.size === 0 ? "Select at least one source-verified project." : "Human-review the selected projects against their durable source evidence."}>
              {batchingProjects ? "Reviewing…" : `Human-review selected (${selectedProjects.size})`}
            </button>
          </div>'''
source, count = project_pattern.subn(project_replacement, source, count=1)
if count != 1:
    raise SystemExit(f"Expected one project action block, found {count}")

path.write_text(source)
PY
echo "PR #1249 — Review Inbox disabled-control explanations adapted to SOURCE_VERIFIED" >> /tmp/applied-groups.txt

apply_group() {
  local label="$1"
  shift
  local patch="/tmp/$(echo "$label" | tr ' /' '__').patch"
  git diff --binary origin/main origin/pr-1251 -- "$@" > "$patch"
  if [ ! -s "$patch" ]; then
    echo "$label — no donor delta" >> /tmp/skipped-groups.txt
    return 0
  fi
  if git apply --check "$patch"; then
    git apply --index "$patch"
    chmod 644 "$@" 2>/dev/null || true
    git add "$@"
    echo "$label" >> /tmp/applied-groups.txt
  else
    echo "$label — current architecture diverged; manual review required" >> /tmp/skipped-groups.txt
  fi
}

apply_group "PR #1251 — production-safe password-reset base URL" app/api/auth/forgot-password/route.ts
apply_group "PR #1251 — canonical SVG dash icon component" components/icons.tsx
apply_group "PR #1251 — authentication observability" lib/auth.ts
apply_group "PR #1251 — audit persistence observability" lib/audit.ts
apply_group "PR #1251 — notification observability" lib/notifications.ts
apply_group "PR #1251 — AI usage observability" lib/ai-usage-tracker.ts
apply_group "PR #1251 — runtime-readiness observability" lib/engine/runtime-readiness-facts.ts
apply_group "PR #1251 — lifecycle observability" lib/engine/tender-lifecycle-orchestrator.ts
apply_group "PR #1251 — deep-reasoning status observability" app/api/system/deep-reasoning-status/route.ts
apply_group "PR #1251 — AI proposal side-effect observability" 'app/api/tenders/[id]/ai-proposal/route.ts'

python - <<'PY'
from pathlib import Path

path = Path("lib/engine/canonical-readiness-state.ts")
source = path.read_text()
old_import = 'import { CheckIcon, WarningIcon, CrossIcon, RefreshIcon, AlertCircleIcon, CircleIcon } from "../../components/icons";'
new_import = 'import { CheckIcon, WarningIcon, CrossIcon, RefreshIcon, AlertCircleIcon, CircleIcon, DashIcon } from "../../components/icons";'
if source.count(old_import) != 1:
    raise SystemExit("Canonical readiness icon import changed unexpectedly")
source = source.replace(old_import, new_import)
old_na = 'NOT_APPLICABLE: { label: "N/A", icon: "—", textClass: "text-slate-400", bgClass: "bg-slate-50", borderClass: "border-slate-100" },'
new_na = 'NOT_APPLICABLE: { label: "N/A", icon: createElement(DashIcon), textClass: "text-slate-400", bgClass: "bg-slate-50", borderClass: "border-slate-100" },'
if source.count(old_na) != 1:
    raise SystemExit("Canonical NOT_APPLICABLE configuration changed unexpectedly")
path.write_text(source.replace(old_na, new_na))
PY
echo "PR #1251 — canonical NOT_APPLICABLE SVG consumer" >> /tmp/applied-groups.txt

python - <<'PY'
from pathlib import Path

path = Path("lib/engine/analysis-state-resolver.ts")
source = path.read_text()
if 'import { logger } from "@/lib/observability";' not in source:
    anchor = 'import { redactSecrets } from "../sanitize-error";'
    if source.count(anchor) != 1:
        raise SystemExit("Analysis resolver import anchor changed unexpectedly")
    source = source.replace(anchor, anchor + '\nimport { logger } from "@/lib/observability";')
old = '''      } catch {
        // Malformed JSON — skip
      }'''
new = '''      } catch (error) {
        logger.warn("[analysis-state-resolver] malformed staged JSON — skipping", {
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
      }'''
if source.count(old) != 1:
    raise SystemExit("Analysis resolver malformed-JSON catch changed unexpectedly")
path.write_text(source.replace(old, new))
PY
echo "PR #1251 — analysis-state malformed-payload observability" >> /tmp/applied-groups.txt

echo "PR #1251 — TenderBreadcrumb prop cleanup — superseded because the component no longer exists" >> /tmp/skipped-groups.txt

mkdir -p public
git show origin/pr-1251:public/icon-192.png > public/icon-192.png
git show origin/pr-1251:public/icon-512.png > public/icon-512.png
chmod 644 public/icon-192.png public/icon-512.png
git add public/icon-192.png public/icon-512.png
echo "PR #1251 — missing PWA/Electron icon assets" >> /tmp/applied-groups.txt

cat > tests/open-pr-donor-reconciliation.test.ts <<'TS'
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("open-PR donor UI reconciliation", () => {
  it("keeps Review Inbox blockers explanatory and actionable", () => {
    const source = read("app/dashboard/company/review/page.tsx");
    assert.match(source, /No experts on this page are eligible for human review/);
    assert.match(source, /No projects on this page are eligible for human review/);
    assert.match(source, /No source-verified experts on this page are eligible/);
    assert.match(source, /No source-verified projects on this page are eligible/);
    assert.match(source, /disabled:cursor-not-allowed/);
  });

  it("prevents compliance controls and tables from widening mobile pages", () => {
    const source = read("app/dashboard/compliance/compliance-dashboard.tsx");
    assert.match(source, /max-w-full min-w-0 rounded-lg border/);
    assert.match(source, /max-w-\[60ch\] truncate/);
    const tables = (source.match(/<table/g) ?? []).length;
    const wrappers = (source.match(/overflow-x-auto/g) ?? []).length;
    assert.ok(wrappers >= tables, `Expected at least ${tables} overflow wrappers, got ${wrappers}`);
  });

  it("uses an SVG component for NOT_APPLICABLE", () => {
    const source = read("lib/engine/canonical-readiness-state.ts");
    assert.match(source, /NOT_APPLICABLE:[\s\S]*createElement\(DashIcon\)/);
    assert.doesNotMatch(source, /NOT_APPLICABLE:[^\n]*icon:\s*"—"/);
  });
});

describe("open-PR donor asset reconciliation", () => {
  it("provides valid PNG signatures for both required PWA icons", () => {
    for (const path of ["public/icon-192.png", "public/icon-512.png"]) {
      const bytes = readFileSync(path);
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });
});
TS

mkdir -p docs/recovery
{
  echo "# Open PR donor reconciliation — 2026-07-24"
  echo
  echo 'Base: `5259726455b3d26ed82b4e8b13543c536126af12`'
  echo
  echo "## Applied"
  sed 's/^/- /' /tmp/applied-groups.txt
  echo
  echo "## Not applied automatically"
  if [ -s /tmp/skipped-groups.txt ]; then sed 's/^/- /' /tmp/skipped-groups.txt; else echo "- None"; fi
  echo
  echo "## Rejected donor"
  echo "- PR #1244 was not merged: concurrent AI_ANALYZE/ENGINE_RUN queueing, setupCompletedAt cache misuse, and broad category promotion are superseded by PR #1248's atomic server orchestration and claim-level SOURCE_VERIFIED model."
} > docs/recovery/open-pr-donor-reconciliation-20260724.md

rm -f \
  .github/workflows/consolidate-open-pr-donors.yml \
  .github/workflows/diagnose-open-pr-donors.yml \
  scripts/reconcile-open-pr-donors.sh

git add -A

npm ci
npx prisma generate
npm run typecheck
npm run lint
node --import tsx --test tests/open-pr-donor-reconciliation.test.ts
git diff --check

git config user.name "PR 1175 Consolidation"
git config user.email "consolidation@hope-tender.local"
git commit -m "fix: reconcile remaining open PR donors end to end"
git push origin HEAD:consolidate/open-pr-donors-20260724
