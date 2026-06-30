#!/usr/bin/env python3
"""Mutation checks for the comprehensive fix commit."""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")
ENV = {
    **os.environ,
    "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public",
    "RUN_DB_INTEGRATION": "true",
    "GEMINI_API_KEY": "AIzaTestKeyNotUsedAtRuntime12345678901234567890",
    "SESSION_SECRET": "test-session-secret-at-least-32-characters-long-for-hmac",
    "NODE_ENV": "test",
}

def run_test(test_file):
    result = subprocess.run(
        ["npx", "tsx", "--test", test_file],
        cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=180,
    )
    return result.returncode, result.stdout + result.stderr

def is_test_failure(output):
    for line in output.splitlines():
        m = re.match(r"ℹ fail (\d+)", line.strip())
        if m and int(m.group(1)) > 0:
            return True
    return False

def backup(path):
    bp = Path("/tmp") / f"comp-fix-backup-{path.name}-{os.getpid()}"
    shutil.copy2(path, bp)
    return bp

def restore(path, bp):
    shutil.copy2(bp, path)
    bp.unlink()

def check_mutation(name, test_file):
    print(f"\n{'━' * 80}")
    print(f"MUTATION: {name}")
    print(f"TEST:     {test_file}")
    print(f"{'━' * 80}")
    code, output = run_test(test_file)
    for line in output.splitlines()[-10:]:
        print(line)
    if is_test_failure(output):
        print("✓ MUTATION DETECTED")
        return True
    else:
        print("✗ MUTATION NOT DETECTED")
        return False

def mutate_file(path, find, replace):
    content = path.read_text()
    if find not in content:
        print(f"  ✗ PATTERN NOT FOUND in {path}")
        return False
    new_content = content.replace(find, replace, 1)
    path.write_text(new_content)
    return True

def main():
    print("━" * 80)
    print("BASELINE")
    print("━" * 80)
    code, output = run_test("tests/comprehensive-fix-mutation-guards.test.ts")
    for line in output.splitlines()[-6:]:
        print(line)
    if is_test_failure(output):
        print("✗ BASELINE FAILS")
        return 1
    print("✓ Baseline passes")

    results = []

    # ─── Fix 1 mutation: restore old hashBuildPlanState ─────────────────────
    print("\nMUTATION F1: restore old hashBuildPlanState in build-plan.ts")
    target = ROOT / "lib/engine/build-plan.ts"
    bp = backup(target)
    # Re-introduce the old hashBuildPlanState export and use it instead of
    # computeBuildPlanHash. This makes the "build-plan.ts uses computeBuildPlanHash"
    # assertion fail because the import is gone.
    mutated = mutate_file(
        target,
        '  const { computeBuildPlanHash, buildPlanHashInputFromTender } = await import("./build-plan-hash");\n  return computeBuildPlanHash(buildPlanHashInputFromTender({',
        '  // MUTATION: use old hashBuildPlanState instead of canonical computeBuildPlanHash\n  return hashBuildPlanState({ tender: tender.id, items: planItems.length });\n  const { computeBuildPlanHash, buildPlanHashInputFromTender } = await import("./build-plan-hash");\n  return computeBuildPlanHash(buildPlanHashInputFromTender({',
    )
    # Also re-add the hashBuildPlanState function so the file compiles
    if mutated:
        mutate_file(
            target,
            'function normalizeText(value: unknown): string {',
            'function stable(value: unknown): string { return JSON.stringify(value); }\nexport function hashBuildPlanState(input: unknown): string { return createHash("sha256").update(stable(input)).digest("hex"); }\nfunction normalizeText(value: unknown): string {',
        )
        result = check_mutation("restore old hash", "tests/comprehensive-fix-mutation-guards.test.ts")
        results.append(("F1: restore old hash", result))
    restore(target, bp)

    # ─── Fix 2 mutation: restore deleteMany in confirm ─────────────────────
    print("\nMUTATION F2: restore deleteMany in confirm route")
    target = ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '    // CONFIRM updates the SAME DRAFT row — never delete a confirmed plan.\n    // The one-row-per-tender constraint (tenderId @unique) guarantees no\n    // duplicate. confirmedRevision/confirmedContentHash snapshot the current\n    // revision+hash so post-confirmation drift is detectable.\n    const confirmed = await (tx as any).buildPlan.update({',
        '    await (tx as any).buildPlan.deleteMany({ where: { tenderId: id, status: "CONFIRMED" } });\n    const confirmed = await (tx as any).buildPlan.update({',
    )
    if mutated:
        result = check_mutation("restore deleteMany", "tests/comprehensive-fix-mutation-guards.test.ts")
        results.append(("F2: restore deleteMany", result))
    restore(target, bp)

    # ─── Fix 6 mutation: remove quote containment check ────────────────────
    print("\nMUTATION F6: remove quote containment check from gate")
    target = ROOT / "lib/engine/generation-readiness-gate.ts"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '    // QUOTE CONTAINMENT: the normalized quote MUST actually appear in the\n    // extracted text of the referenced ACTIVE TenderFile. Without this, a\n    // foreign/guessed/unsupported quote could pass the structural check.\n    const fileText = (r.sourceFileExtractedText ?? "").toLowerCase().replace(/\\s+/g, " ").trim();\n    const normalizedQuote = quote.toLowerCase().replace(/\\s+/g, " ").trim();\n    if (quote.length >= MIN_MEANINGFUL_QUOTE_CHARS && (fileText.length === 0 || !fileText.includes(normalizedQuote))) {\n      return fail("REQUIREMENT_QUOTE_NOT_IN_FILE", "At least one mandatory requirement has a source quote that is not contained in the extracted text of the referenced active TenderFile. Foreign, guessed, or unsupported evidence is blocked. Re-run AI Analyze to ground requirements.");\n    }',
        '    // MUTATION: quote containment check removed',
    )
    if mutated:
        result = check_mutation("remove quote containment", "tests/comprehensive-fix-mutation-guards.test.ts")
        results.append(("F6: remove quote containment", result))
    restore(target, bp)

    # ─── Fix 9 mutation: restore non-fatal verification ────────────────────
    print("\nMUTATION F9: restore non-fatal migration verification")
    target = ROOT / "scripts/migrate-deploy-safe.mjs"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '  throw new Error("Migration deployment FAILED: retroactive init verification did not pass. Database schema is not in a safe state.");',
        '  // MUTATION: non-fatal warning\n  console.warn("Non-fatal warning");',
    )
    if mutated:
        result = check_mutation("restore non-fatal verification", "tests/comprehensive-fix-mutation-guards.test.ts")
        results.append(("F9: restore non-fatal verification", result))
    restore(target, bp)

    # ─── Summary ───────────────────────────────────────────────────────────
    print("\n" + "━" * 80)
    print("COMPREHENSIVE FIX MUTATION CHECK SUMMARY")
    print("━" * 80)
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  {status}  {name}")
    pass_count = sum(1 for _, p in results if p)
    fail_count = len(results) - pass_count
    print(f"\nPASS: {pass_count} / {len(results)}")
    print(f"FAIL: {fail_count} / {len(results)}")
    return 1 if fail_count > 0 else 0

if __name__ == "__main__":
    sys.exit(main())
