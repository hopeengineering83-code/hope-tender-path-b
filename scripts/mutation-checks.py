#!/usr/bin/env python3
"""Mutation checks for release-safety consolidation.

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
    """Run a single test file and return (exit_code, output)."""
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
    """Return True if the test summary line shows ≥1 failure."""
    for line in output.splitlines():
        m = re.match(r"ℹ fail (\d+)", line.strip())
        if m and int(m.group(1)) > 0:
            return True
    return False


def backup(path: Path) -> Path:
    backup_path = Path("/tmp") / f"mutation-backup-{path.name}-{os.getpid()}"
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
    # Print last 15 lines for visibility
    for line in output.splitlines()[-15:]:
        print(line)
    if is_test_failure(output):
        print("✓ MUTATION DETECTED (test failed as expected)")
        return True
    else:
        print("✗ MUTATION NOT DETECTED (test still passed — protection gap!)")
        return False


def mutate_file(path: Path, find: str, replace: str) -> bool:
    """Replace `find` with `replace` in `path`. Return True if replacement happened."""
    content = path.read_text()
    if find not in content:
        print(f"  ✗ PATTERN NOT FOUND in {path}")
        return False
    new_content = content.replace(find, replace, 1)
    path.write_text(new_content)
    return True


def main():
    print("━" * 80)
    print("BASELINE: confirm tests pass before mutations")
    print("━" * 80)
    code, output = run_test("tests/generate-docs-gate.test.ts")
    for line in output.splitlines()[-8:]:
        print(line)
    if is_test_failure(output):
        print("✗ Baseline FAILS — fix before mutations")
        return 1
    print("✓ Baseline passes")

    results = []

    # ─── Mutation 1: reintroduce acceptPartialExtraction bypass ──────────────
    print("\nMUTATION 1/7: reintroduce acceptPartialExtraction bypass")
    target = ROOT / "tests/generate-docs-gate.test.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        'if (analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {',
        'if (analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED" && !_acceptPartialExtraction) {',
    )
    if mutated:
        result = check_mutation("acceptPartialExtraction bypass", "tests/generate-docs-gate.test.ts")
        results.append(("acceptPartialExtraction bypass", result))
    restore(target, backup_path)

    # ─── Mutation 2: allow human-approved regex fallback (re-introduce ok:true) ─
    print("\nMUTATION 2/7: allow human-approved regex fallback to authorize")
    target = ROOT / "lib/engine/analysis-source.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '  const source = await detectAnalysisSourceWithApproval(client, tenderId, tender);\n  if (source === "AI") return { ok: true };',
        '  const source = await detectAnalysisSourceWithApproval(client, tenderId, tender);\n  if (source === "AI" || source === "HUMAN_APPROVED_REGEX_FALLBACK") return { ok: true };',
    )
    if mutated:
        result = check_mutation("human-approved regex fallback unlock", "tests/analysis-source-approval.test.ts")
        results.append(("human-approved regex fallback unlock", result))
    restore(target, backup_path)

    # ─── Mutation 3: remove confirmed BuildPlan enforcement (back to === false) ─
    print("\nMUTATION 3/7: remove confirmed BuildPlan enforcement")
    target = ROOT / "lib/engine/generation-readiness-gate.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        "if (input.hasCurrentConfirmedBuildPlan !== true) {",
        "if (input.hasCurrentConfirmedBuildPlan === false) {",
    )
    if mutated:
        # Test that undefined bypasses the check — use a test that omits the field
        result = check_mutation("confirmed BuildPlan enforcement removed", "tests/build-plan-release-safety.test.ts")
        results.append(("confirmed BuildPlan enforcement removed", result))
    restore(target, backup_path)

    # ─── Mutation 4: restore GeneratedDocument plan proxy in generate route ───
    print("\nMUTATION 4/7: restore GeneratedDocument plan proxy")
    target = ROOT / "app/api/tenders/[id]/generate/route.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        '// hasValidSubmissionPlan was REMOVED — GeneratedDocument rows must never be\n// used as a BuildPlan proxy. The authoritative plan check is enforced by\n// assertTenderReadyForGenerationAndExport (hasCurrentConfirmedBuildPlan +\n// recordedBuildPlanState) further below.',
        'import { hasValidSubmissionPlan } from "../../../../../lib/engine/submission-plan-completeness";',
    )
    if mutated:
        # Re-add the proxy check too
        mutate_file(
            target,
            '  // ── Submission plan gate ──────────────────────────────────────────────────\n  // BuildPlan is the AUTHORITATIVE plan. GeneratedDocument rows MUST NEVER be\n  // used as a proxy for plan existence — that was the legacy hasValidSubmission\n  // path which counted any non-SUPERSEDED row (including PLANNED/pending rows)\n  // as proof of a plan, then bypassed the real BuildPlan gate. The real\n  // confirmation/enforcement happens in assertTenderReadyForGenerationAndExport\n  // below via hasCurrentConfirmedBuildPlan + recordedBuildPlanState. planOnly\n  // is NOT exempt from any safety gate.\n  {\n    // No proxy check here — GeneratedDocument rows are not plan evidence.\n    // The authoritative BuildPlan gate runs unconditionally below.\n  }',
            '  // ── Submission plan gate ──────────────────────────────────────────────────\n  {\n    const planCheck = await hasValidSubmissionPlan(prisma, tender.id);\n    if (!planCheck.valid) {\n      return NextResponse.json({ errorCode: "NO_SUBMISSION_PLAN", error: "No submission plan exists." }, { status: 400 });\n    }\n  }',
        )
        result = check_mutation("GeneratedDocument plan proxy restored", "tests/route-behavioral-gate.test.ts")
        results.append(("GeneratedDocument plan proxy restored", result))
    restore(target, backup_path)

    # ─── Mutation 5: alter provider order (swap Gemini and Anthropic) ────────
    print("\nMUTATION 5/7: alter provider order")
    target = ROOT / "lib/ai-provider-catalog.cjs"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        'const CANONICAL_AI_PROVIDER_ORDER = [\n  "zai",\n  "cerebras",\n  "mistral",\n  "groq",\n  "openrouter",\n  "gemini",\n  "openai",\n  "together",\n  "deepseek",\n  "anthropic",\n];',
        'const CANONICAL_AI_PROVIDER_ORDER = [\n  "anthropic",\n  "openrouter",\n  "openai",\n  "groq",\n  "deepseek",\n  "gemini",\n];',
    )
    if mutated:
        result = check_mutation("provider order altered", "tests/build-plan-release-safety.test.ts")
        results.append(("provider order altered", result))
    restore(target, backup_path)

    # ─── Mutation 6: allow deleted/foreign evidence ──────────────────────────
    print("\nMUTATION 6/7: allow deleted/foreign evidence")
    target = ROOT / "lib/engine/build-plan.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        'if (!file) blockers.push(`Requirement ${reqId} evidence is not an ACTIVE TenderFile on this tender.`);',
        '// MUTATION: file check disabled',
    )
    if mutated:
        result = check_mutation("deleted/foreign evidence allowed", "tests/build-plan-release-safety.test.ts")
        results.append(("deleted/foreign evidence allowed", result))
    restore(target, backup_path)

    # ─── Mutation 7: re-enable ensurePlannedGeneratedDocumentRecords ─────────
    print("\nMUTATION 7/7: re-enable ensurePlannedGeneratedDocumentRecords")
    target = ROOT / "app/api/tenders/[id]/generate/route.ts"
    backup_path = backup(target)
    mutated = mutate_file(
        target,
        'async function ensurePlannedGeneratedDocumentRecords(_tenderId: string, _plannedFiles: SubmissionPlanFile[]): Promise<number> {\n  return 0;\n}',
        'async function ensurePlannedGeneratedDocumentRecords(_tenderId: string, _plannedFiles: SubmissionPlanFile[]): Promise<number> {\n  return _plannedFiles.length;\n}',
    )
    if mutated:
        result = check_mutation("ensurePlanned re-enabled", "tests/route-behavioral-gate.test.ts")
        results.append(("ensurePlanned re-enabled", result))
    restore(target, backup_path)

    # ─── Summary ─────────────────────────────────────────────────────────────
    print("\n" + "━" * 80)
    print("MUTATION CHECK SUMMARY")
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
