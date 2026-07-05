#!/usr/bin/env python3
"""Investigation script — runs on the target branch atomically."""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")

def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.stdout + r.stderr

# Checkout target branch
print("=== CHECKOUT ===")
print(run("git checkout hotfix/release-safety-consolidation"))
print(run("git log --oneline -1"))
print()

# Investigation 1: build-plan service
print("=== INVESTIGATION 1: build-plan.ts service ===")
p = ROOT / "lib/engine/build-plan.ts"
if p.exists():
    content = p.read_text()
    for i, line in enumerate(content.split('\n'), 1):
        if any(k in line for k in ['export ', 'function ', 'upsert', 'findFirst', 'deleteMany', 'computeBuildPlanHash', 'computeTenderBuildPlanHash', 'hashBuildPlanState', 'preflight', 'assertTenderReady', 'serializable']):
            print(f"  {i}: {line.rstrip()}")
else:
    print("  FILE NOT FOUND")
print()

# Confirm route
print("=== confirm route ===")
p = ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts"
if p.exists():
    print(p.read_text())
else:
    print("  FILE NOT FOUND")
print()

# build-plan route
print("=== build-plan route ===")
p = ROOT / "app/api/tenders/[id]/build-plan/route.ts"
if p.exists():
    print(p.read_text())
else:
    print("  FILE NOT FOUND")
print()

# submission-plan/build route — check for heuristic/derived
print("=== submission-plan/build route (heuristic check) ===")
p = ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts"
if p.exists():
    content = p.read_text()
    for i, line in enumerate(content.split('\n'), 1):
        if any(k in line for k in ['buildSubmissionPlanWithDerivedFallback', 'buildDerivedDraftPlan', 'DERIVED_DRAFT', 'derived', 'heuristic', 'buildDraftBuildPlan', 'preflight', 'assertTenderReady']):
            print(f"  {i}: {line.rstrip()}")
else:
    print("  FILE NOT FOUND")
print()

# generation-readiness-gate — check for preflight + quote containment
print("=== gate: preflight + quote containment ===")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
if p.exists():
    content = p.read_text()
    for i, line in enumerate(content.split('\n'), 1):
        if any(k in line for k in ['assertTenderReadyToDraftBuildPlan', 'preflight', 'REQUIREMENT_QUOTE_NOT_IN_FILE', 'sourceFileExtractedText', 'fileText.includes']):
            print(f"  {i}: {line.rstrip()}")
else:
    print("  FILE NOT FOUND")
print()

# build-plan-hash.ts — check what's included
print("=== build-plan-hash.ts input fields ===")
p = ROOT / "lib/engine/build-plan-hash.ts"
if p.exists():
    content = p.read_text()
    for i, line in enumerate(content.split('\n'), 1):
        if any(k in line for k in ['BuildPlanHashInput', 'exactFileNaming', 'exactFileOrder', 'submissionMethod', 'submissionEmail', 'deadline', 'submissionEmailSubject', 'items', 'sourceRequirementIds', 'envelope', 'format', 'restrictions']):
            print(f"  {i}: {line.rstrip()}")
else:
    print("  FILE NOT FOUND")
