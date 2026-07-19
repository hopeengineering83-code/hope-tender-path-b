#!/usr/bin/env bash
set -euo pipefail

SOURCE_BRANCH="agent/pr1175-final-gap-repair"
SOURCE_SHA="69bddb0753bb644e469aea4c7db0d33338349ea3"
BASE_SHA="bfe688c22c89afbe1ce40d5aa1ab183ba44d25d2"

if ! git merge-base --is-ancestor "$BASE_SHA" HEAD; then
  echo "Repair branch is not based on the exact current PR #1175 head $BASE_SHA." >&2
  exit 1
fi

unexpected_before=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v -E '^scripts/pr1175-complete-gap-closure\.sh$|^\.github/workflows/pr1175-complete-gap-closure\.yml$' || true)
if [[ -n "$unexpected_before" ]]; then
  echo "Unexpected pre-existing branch changes:" >&2
  echo "$unexpected_before" >&2
  exit 1
fi

git fetch --no-tags origin "$SOURCE_BRANCH"
if [[ "$(git rev-parse FETCH_HEAD)" != "$SOURCE_SHA" ]]; then
  echo "PR #1204 moved: expected $SOURCE_SHA, got $(git rev-parse FETCH_HEAD)." >&2
  exit 1
fi

# These files have no later conflict with the current #1175 implementation.
# Materialize the validated source versions exactly.
files=(
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

# The expert/project routes contain two independently required protections:
# 1. current #1175 PUT handlers demote REVIEWED rows when evidence fields change;
# 2. PR #1204 PATCH handlers fail closed on missing provenance and commit review
#    state + audit identity atomically.
# Merge at function granularity so neither protection overwrites the other.
python3 - <<'PY'
from pathlib import Path
import subprocess

SOURCE_SHA = "69bddb0753bb644e469aea4c7db0d33338349ea3"


def source_text(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{SOURCE_SHA}:{path}"], text=True)


def extract_patch_function(text: str) -> str:
    start = text.index("export async function PATCH(")
    end = text.index("\nexport async function DELETE(", start)
    return text[start:end]


def merge_route(path: str, record_kind: str) -> None:
    target_path = Path(path)
    target = target_path.read_text()
    source = source_text(path)

    request_import = 'import { extractRequestId } from "../../../../../lib/request-id";'
    if request_import not in target:
        anchor = 'import { logAction } from "../../../../../lib/audit";'
        if target.count(anchor) != 1:
            raise SystemExit(f"{path}: expected one audit import")
        target = target.replace(anchor, anchor + "\n" + request_import)

    field_fn = "expertReviewFields" if record_kind == "expert" else "projectReviewFields"
    old_import = f'import {{ {field_fn}, reviewEvidenceEquals }} from "../../../../../lib/vault-review-provenance";'
    new_import = (
        'import {\n'
        '  buildReviewProvenance,\n'
        f'  {field_fn},\n'
        '  publicVaultIdentifier,\n'
        '  reviewEvidenceEquals,\n'
        '} from "../../../../../lib/vault-review-provenance";'
    )
    if target.count(old_import) != 1:
        raise SystemExit(f"{path}: expected one combined review-evidence import")
    target = target.replace(old_import, new_import)

    target_start = target.index("export async function PATCH(")
    target_end = target.index("\nexport async function DELETE(", target_start)
    source_patch = extract_patch_function(source)
    target = target[:target_start] + source_patch + target[target_end:]

    required = [
        "reviewEvidenceEquals",
        "review invalidated — reviewed evidence fields were edited",
        "buildReviewProvenance",
        "extractRequestId(req)",
        "prisma.$transaction",
        "updateMany",
        "publicVaultIdentifier",
        "CONCURRENT_UPDATE",
    ]
    for contract in required:
        if contract not in target:
            raise SystemExit(f"{path}: missing merged route contract {contract}")

    target_path.write_text(target)


merge_route("app/api/company/experts/[id]/route.ts", "expert")
merge_route("app/api/company/projects/[id]/route.ts", "project")

# Resolve matching.ts manually: retain the latest #1175/#1203 strict threshold,
# domain, and no-fallback portfolio logic while adding canonical provenance.
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

# Cross-feature assertions: existing edit demotion and new atomic approval must
# both be present in the final product files.
grep -Fq 'reviewEvidenceEquals' 'app/api/company/experts/[id]/route.ts'
grep -Fq 'review invalidated — reviewed evidence fields were edited' 'app/api/company/experts/[id]/route.ts'
grep -Fq 'reviewEvidenceEquals' 'app/api/company/projects/[id]/route.ts'
grep -Fq 'review invalidated — reviewed evidence fields were edited' 'app/api/company/projects/[id]/route.ts'
grep -Fq 'buildReviewProvenance' 'app/api/company/experts/[id]/route.ts'
grep -Fq 'buildReviewProvenance' 'app/api/company/projects/[id]/route.ts'
grep -Fq 'prisma.$transaction' 'app/api/company/experts/[id]/route.ts'
grep -Fq 'prisma.$transaction' 'app/api/company/projects/[id]/route.ts'
grep -Fq 'const SELECTION_THRESHOLD = 0.75' lib/engine/matching.ts
grep -Fq 'const eligible = strictEligible.length > 0' lib/engine/matching.ts
! grep -Fq 'let eligible = strictEligible.length > 0' lib/engine/matching.ts
grep -Fq 'canUseVaultRecord' lib/engine/matching-eligibility.ts
grep -Fq 'VAULT_REVIEW_CONSUMER_SELECT' 'app/api/tenders/[id]/ai-rematch/route.ts'
grep -Fq 'persistenceAtomic: true' 'app/api/tenders/[id]/ai-rematch/route.ts'
grep -Fq 'isDurablyReviewed' lib/engine/run-tender-engine.ts

echo "Final gap repair merged at function level with all current #1175 safeguards preserved."