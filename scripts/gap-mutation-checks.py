#!/usr/bin/env python3
"""Mutation checks for gap-closure commit.

Applies each mutation, runs a targeted test, expects failure, then reverts.
Each mutation MUST make its relevant test fail; otherwise the protection is
not actually enforced by the test.
"""
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


def run_test(test_file: str) -> tuple[int, str]:
    result = subprocess.run(
        ["npx", "tsx", "--test", test_file],
        cwd=ROOT,
        env=ENV,
        capture_output=True,
        text=True,
        timeout=180,
    )
    return result.returncode, result.stdout + result.stderr


def is_test_failure(output: str) -> bool:
    for line in output.splitlines():
        m = re.match(r"ℹ fail (\d+)", line.strip())
        if m and int(m.group(1)) > 0:
            return True
    return False


def backup(path: Path) -> Path:
    backup_path = Path("/tmp") / f"gap-mutation-backup-{path.name}-{os.getpid()}"
    shutil.copy2(path, backup_path)
    return backup_path


def restore(path: Path, backup_path: Path) -> None:
    shutil.copy2(backup_path, path)
    backup_path.unlink()


def check_mutation(name: str, test_file: str) -> bool:
    print(f"\n{'━' * 80}")
    print(f"MUTATION: {name}")
    print(f"TEST:     {test_file}")
    print(f"{'━' * 80}")
    code, output = run_test(test_file)
    for line in output.splitlines()[-15:]:
        print(line)
    if is_test_failure(output):
        print("✓ MUTATION DETECTED (test failed as expected)")
        return True
    else:
        print("✗ MUTATION NOT DETECTED (test still passed — protection gap!)")
        return False


def mutate_file(path: Path, find: str, replace: str) -> bool:
    content = path.read_text()
    if find not in content:
        print(f"  ✗ PATTERN NOT FOUND in {path}")
        return False
    new_content = content.replace(find, replace, 1)
    path.write_text(new_content)
    return True


def main():
    print("━" * 80)
    print("BASELINE: confirm gap-closure tests pass before mutations")
    print("━" * 80)
    code, output = run_test("tests/gap-closure-mutation-guards.test.ts")
    for line in output.splitlines()[-8:]:
        print(line)
    if is_test_failure(output):
        print("✗ Baseline FAILS — fix before mutations")
        return 1
    print("✓ Baseline passes")

    results = []

    # ─── Gap 2 mutation: re-introduce length-based token acceptance ─────────
    print("\nMUTATION G2: re-introduce sourceFileToken.length > 20 acceptance")
    target = ROOT / "lib/ai-jobs/analysis-job-service.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '        sourceTenderFileId,\n        sourcePageNumber: req.sourcePage,',
        '        sourceTenderFileId: req.sourceTenderFileId || (req.sourceFileToken && req.sourceFileToken.length > 20 ? req.sourceFileToken : null),\n        sourcePageNumber: req.sourcePage,',
    )
    if mutated:
        result = check_mutation("re-introduce length-based token acceptance", "tests/gap-closure-mutation-guards.test.ts")
        results.append(("G2: length-based token acceptance", result))
    restore(target, backup_path)

    # ─── Gap 4 mutation: re-allow HUMAN_APPROVED in bid-strategy ────────────
    print("\nMUTATION G4: re-allow HUMAN_APPROVED_REGEX_FALLBACK in bid-strategy")
    target = ROOT / "app/api/tenders/[id]/bid-strategy/route.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        'function isUnapprovedFallbackOrUnknown(value: string | null | undefined): boolean {\n  // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK is audit-only and MUST\n  // NEVER authorize bid strategy (or any release action). Treat it the same\n  // as unapproved regex fallback — only genuine "AI" authorizes release.\n  const upper = String(value ?? "").toUpperCase();\n  return upper === "UNKNOWN" || upper.includes("REGEX_FALLBACK") || upper.includes("DETERMINISTIC_FALLBACK");\n}',
        'function isUnapprovedFallbackOrUnknown(value: string | null | undefined): boolean {\n  const upper = String(value ?? "").toUpperCase();\n  if (upper === "HUMAN_APPROVED_REGEX_FALLBACK") return false;\n  return upper === "UNKNOWN" || upper.includes("REGEX_FALLBACK") || upper.includes("DETERMINISTIC_FALLBACK");\n}',
    )
    if mutated:
        result = check_mutation("re-allow HUMAN_APPROVED in bid-strategy", "tests/gap-closure-mutation-guards.test.ts")
        results.append(("G4: re-allow HUMAN_APPROVED in bid-strategy", result))
    restore(target, backup_path)

    # ─── Gap 5 mutation: remove HUMAN_APPROVED_REGEX block from seven-pass ──
    print("\nMUTATION G5: remove HUMAN_APPROVED_REGEX block from seven-pass TENDER_COMPREHENSION")
    target = ROOT / "lib/engine/seven-pass-generation.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '    ...(analysisSource === "HUMAN_APPROVED_REGEX" ? ["Tender was analyzed by regex fallback and human-approved as audit-only. Human approval no longer authorizes final output — re-run AI Analyze with healthy providers."] : []),',
        '    // MUTATION: HUMAN_APPROVED_REGEX block removed',
    )
    if mutated:
        result = check_mutation("remove HUMAN_APPROVED_REGEX block from seven-pass", "tests/gap-closure-mutation-guards.test.ts")
        results.append(("G5: remove HUMAN_APPROVED block from seven-pass", result))
    restore(target, backup_path)

    # ─── Gap 7 mutation: re-allow HUMAN_APPROVED in analysisOk ──────────────
    print("\nMUTATION G7: re-allow HUMAN_APPROVED_REGEX_FALLBACK in analysisOk")
    target = ROOT / "lib/engine/tender-lifecycle-orchestrator.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '  const analysisOk = analysisSource === "AI";',
        '  const analysisOk = analysisSource === "AI" || analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";',
    )
    if mutated:
        result = check_mutation("re-allow HUMAN_APPROVED in analysisOk", "tests/gap-closure-mutation-guards.test.ts")
        results.append(("G7: re-allow HUMAN_APPROVED in analysisOk", result))
    restore(target, backup_path)

    # ─── Gap 8 mutation: remove HUMAN_APPROVED block from final-submission ──
    print("\nMUTATION G8: remove HUMAN_APPROVED_REGEX_FALLBACK block from final-submission-readiness")
    target = ROOT / "lib/engine/final-submission-readiness.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '  if (analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {',
        '  if (false && analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {  // MUTATION: disabled',
    )
    if mutated:
        result = check_mutation("remove HUMAN_APPROVED block from final-submission", "tests/gap-closure-mutation-guards.test.ts")
        results.append(("G8: remove HUMAN_APPROVED block from final-submission", result))
    restore(target, backup_path)

    # ─── Readiness scoring mutation: re-allow no-cap-when-fully-verified ────
    print("\nMUTATION RS: re-allow no-cap-when-fully-verified for HUMAN_APPROVED")
    target = ROOT / "lib/engine/readiness-scoring.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '  if (input.analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {\n    applicableCaps.push({ dimension: "analysisSource", capScore: 45, reason: "Human-approved regex fallback is AUDIT-ONLY and does NOT authorize release. Readiness is capped at 45 until AI analysis is re-run with healthy providers." });\n  }',
        '  if (input.analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {\n    const fullyVerified = (input.sourceReferenceCoverage ?? 0) >= 0.8 && (input.complianceMatrixCoverage ?? 0) >= 0.8;\n    if (!fullyVerified) applicableCaps.push({ dimension: "analysisSource", capScore: 70, reason: "Human-approved regex fallback is draft-review only." });\n  }',
    )
    if mutated:
        result = check_mutation("re-allow no-cap-when-fully-verified", "tests/gap-closure-mutation-guards.test.ts")
        results.append(("RS: re-allow no-cap-when-fully-verified", result))
    restore(target, backup_path)

    # ─── Summary ─────────────────────────────────────────────────────────────
    print("\n" + "━" * 80)
    print("GAP-CLOSURE MUTATION CHECK SUMMARY")
    print("━" * 80)
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  {status}  {name} — {'test failed as expected' if passed else 'test did NOT fail — protection gap!'}")
    pass_count = sum(1 for _, p in results if p)
    fail_count = len(results) - pass_count
    print(f"\nPASS: {pass_count} / {len(results)}")
    print(f"FAIL: {fail_count} / {len(results)}")
    return 1 if fail_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
