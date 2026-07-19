#!/usr/bin/env bash
set -euo pipefail

SOURCE_BRANCH="agent/pr1175-final-gap-repair"
SOURCE_SHA="69bddb0753bb644e469aea4c7db0d33338349ea3"
BASE_SHA="bfe688c22c89afbe1ce40d5aa1ab183ba44d25d2"

if [[ "$(git rev-parse HEAD)" != "$BASE_SHA" && ! -f .gap-closure-applied ]]; then
  echo "Expected the exact current PR #1175 head $BASE_SHA before applying the repair." >&2
  exit 1
fi

git fetch --no-tags origin "$SOURCE_BRANCH"
if [[ "$(git rev-parse FETCH_HEAD)" != "$SOURCE_SHA" ]]; then
  echo "PR #1204 moved: expected $SOURCE_SHA, got $(git rev-parse FETCH_HEAD)." >&2
  exit 1
fi

# Copy the validated ordinary product files that do not overlap the latest
# PR #1175 matching implementation. The sole overlap, matching.ts, is merged
# below using assertion-checked replacements so #1203's fail-closed selection
# semantics remain authoritative.
files=(
  'app/api/company/experts/[id]/route.ts'
  'app/api/company/projects/[id]/route.ts'
  'app/api/tenders/[id]/ai-rematch/route.ts'
  'lib/engine/matching-eligibility.ts'
  'lib/engine/run-tender-engine.ts'
  'scripts/capture-production-pages.mjs'
  'scripts/seed-e2e-user.mjs'
  'tests/matching-fail-closed-negative-tests.test.ts'
  'tests/matching-relevance-gates.test.ts'
  'tests/matching-strict-domain.test.ts'
  'tests/pr1175-final-gap-repair.test.ts'
  'tests/vault-review-route-postgres.test.ts'
)

for path in "${files[@]}"; do
  mkdir -p "$(dirname "$path")"
  git show "$SOURCE_SHA:$path" > "$path"
done

python3 - <<'PY'
from pathlib import Path

path = Path("lib/engine/matching.ts")
text = path.read_text()

old_import = 'import { enforceMatchingEligibility } from "./matching-eligibility";'
new_import = 'import { checkMatchingEligibility } from "./matching-eligibility";'
if text.count(old_import) != 1:
    raise SystemExit(f"Expected exactly one old matching eligibility import, found {text.count(old_import)}")
text = text.replace(old_import, new_import)

old_expert = '''      const score = enforceMatchingEligibility(rawScore, {
        id: expert.id,
        trustLevel,
        sourceDocumentId: (expert as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (expert as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (expert as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
      });'''
new_expert = '''      const matchingEligibility = checkMatchingEligibility({
        id: expert.id,
        companyId: (expert as { companyId?: string }).companyId ?? knowledge.companyId,
        trustLevel,
        sourceDocumentId: (expert as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (expert as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (expert as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
        reviewNotes: (expert as { reviewNotes?: string | null }).reviewNotes ?? null,
        sourceDocument: (expert as { sourceDocument?: never }).sourceDocument ?? null,
        fullName: expert.fullName,
        title: expert.title,
        yearsExperience: expert.yearsExperience,
        disciplines: expert.disciplines,
        sectors: expert.sectors,
        certifications: expert.certifications,
      });
      const score = matchingEligibility.eligible ? rawScore : 0;'''
if text.count(old_expert) != 1:
    raise SystemExit(f"Expected exactly one structural expert gate, found {text.count(old_expert)}")
text = text.replace(old_expert, new_expert)

old_project = '''      const score = enforceMatchingEligibility(rawScore, {
        id: project.id,
        trustLevel,
        sourceDocumentId: (project as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (project as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (project as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
      });'''
new_project = '''      const matchingEligibility = checkMatchingEligibility({
        id: project.id,
        companyId: (project as { companyId?: string }).companyId ?? knowledge.companyId,
        trustLevel,
        sourceDocumentId: (project as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (project as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (project as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
        reviewNotes: (project as { reviewNotes?: string | null }).reviewNotes ?? null,
        sourceDocument: (project as { sourceDocument?: never }).sourceDocument ?? null,
        name: project.name,
        clientName: project.clientName,
        country: project.country,
        sector: project.sector,
        serviceAreas: project.serviceAreas,
        contractValue: project.contractValue,
        currency: project.currency,
      });
      const score = matchingEligibility.eligible ? rawScore : 0;'''
if text.count(old_project) != 1:
    raise SystemExit(f"Expected exactly one structural project gate, found {text.count(old_project)}")
text = text.replace(old_project, new_project)

old_label = '      const trustLabel = trustLevelLabel(trustLevel);'
new_label = '      const trustLabel = matchingEligibility.eligible ? trustLevelLabel(trustLevel) : "⚠ Provenance required";'
if text.count(old_label) != 2:
    raise SystemExit(f"Expected exactly two trust labels, found {text.count(old_label)}")
text = text.replace(old_label, new_label)

required_contracts = [
    'const eligible = strictEligible.length > 0',
    'if (eligible.length === 0)',
    'const matchingEligibility = checkMatchingEligibility({',
    'sourceDocument: (expert as { sourceDocument?: never }).sourceDocument ?? null',
    'sourceDocument: (project as { sourceDocument?: never }).sourceDocument ?? null',
]
for contract in required_contracts:
    if contract not in text:
        raise SystemExit(f"Missing required conflict-resolution contract: {contract}")

for forbidden in [
    'let eligible = strictEligible.length > 0',
    'enforceMatchingEligibility(',
    'candidates.slice(0, Math.min(limit, candidates.length))',
]:
    if forbidden in text:
        raise SystemExit(f"Forbidden fail-open matching construct retained: {forbidden}")

if text.count('⚠ Provenance required') != 2:
    raise SystemExit("Both expert and project rationales must expose provenance-required state.")

path.write_text(text)
PY

# Product-level assertions. These prevent the temporary automation from ever
# committing a weakened threshold, stale structural review authority, or the
# original below-threshold fallback.
grep -Fq 'const SELECTION_THRESHOLD = 0.75' lib/engine/matching.ts
grep -Fq 'const eligible = strictEligible.length > 0' lib/engine/matching.ts
! grep -Fq 'let eligible = strictEligible.length > 0' lib/engine/matching.ts
grep -Fq 'canUseVaultRecord' lib/engine/matching-eligibility.ts
grep -Fq 'VAULT_REVIEW_CONSUMER_SELECT' 'app/api/tenders/[id]/ai-rematch/route.ts'
grep -Fq 'persistenceAtomic: true' 'app/api/tenders/[id]/ai-rematch/route.ts'
grep -Fq 'isDurablyReviewed' lib/engine/run-tender-engine.ts

touch .gap-closure-applied

echo "PR #1204 product delta applied to the exact latest PR #1175 head with the matching conflict resolved."