#!/usr/bin/env python3
"""Update tests that expected old submission-plan/build route logic."""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")

# Update corrupted-extraction-chain-regression.test.ts
p = ROOT / "tests/corrupted-extraction-chain-regression.test.ts"
content = p.read_text()

# Replace references to submission-plan/build route with build-plan.ts service
content = content.replace(
    'app/api/tenders/[id]/submission-plan/build/route.ts',
    'lib/engine/build-plan.ts'
)
# Update the test descriptions
content = content.replace(
    "calls isExtractionAcceptableForGeneration before building the plan",
    "preflight calls isExtractionAcceptableForGeneration before building the plan"
)
content = content.replace(
    'src.includes("EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED")',
    'src.includes("isExtractionAcceptableForGeneration")'
)
p.write_text(content)
print("  Updated corrupted-extraction-chain-regression.test.ts")

# Update ai-analyze-and-generation-gate-wiring.test.ts
p = ROOT / "tests/ai-analyze-and-generation-gate-wiring.test.ts"
content = p.read_text()
content = content.replace(
    'app/api/tenders/[id]/submission-plan/build/route.ts',
    'lib/engine/build-plan.ts'
)
content = content.replace(
    '/EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED/',
    '/isExtractionAcceptableForGeneration/'
)
p.write_text(content)
print("  Updated ai-analyze-and-generation-gate-wiring.test.ts")

# Update build-plan-hardening.test.ts
p = ROOT / "tests/build-plan-hardening.test.ts"
content = p.read_text()
content = content.replace(
    'app/api/tenders/[id]/submission-plan/build/route.ts',
    'lib/engine/build-plan.ts'
)
# Replace pattern checks for route-specific codes with service-level checks
content = content.replace(
    'routeSrc.includes("BUILD_PLAN_BLOCKED_UNSAFE_ANALYSIS")',
    'serviceSrc.includes("assessTenderMetadataCompleteness") || serviceSrc.includes("resolveCanonicalFieldState")'
)
content = content.replace(
    '"Build Plan route must emit BUILD_PLAN_BLOCKED_UNSAFE_ANALYSIS when analysis quality is too poor"',
    '"Build Plan service must have metadata/analysis validation"'
)
content = content.replace(
    'routeSrc.includes("EXTRACTION_QUALITY_INSUFFICIENT")',
    'serviceSrc.includes("isExtractionAcceptableForGeneration")'
)
content = content.replace(
    'routeSrc.includes("EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED")',
    'serviceSrc.includes("isExtractionAcceptableForGeneration")'
)
content = content.replace(
    '"Build Plan route must emit EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED when extraction is corrupted"',
    '"Build Plan service must check extraction quality"'
)
# Update variable names
content = content.replace('routeSrc', 'serviceSrc')
# Update route variable source
content = content.replace(
    'const serviceSrc = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/build-plan/route.ts"), "utf-8");',
    'const serviceSrc = readFileSync(resolve(process.cwd(), "lib/engine/build-plan.ts"), "utf-8");'
)
content = content.replace(
    'const serviceSrc = readFileSync(join(process.cwd(), "app/api/tenders/[id]/build-plan/route.ts"), "utf-8");',
    'const serviceSrc = readFileSync(join(process.cwd(), "lib/engine/build-plan.ts"), "utf-8");'
)
p.write_text(content)
print("  Updated build-plan-hardening.test.ts")

# Update phase33-gap-fixes.test.ts
p = ROOT / "tests/phase33-gap-fixes.test.ts"
content = p.read_text()
content = content.replace(
    'app/api/tenders/[id]/submission-plan/build/route.ts',
    'lib/engine/build-plan.ts'
)
p.write_text(content)
print("  Updated phase33-gap-fixes.test.ts")

print("Done.")
