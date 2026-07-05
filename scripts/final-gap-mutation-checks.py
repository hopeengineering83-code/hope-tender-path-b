#!/usr/bin/env python3
"""Mutation checks for final gap-closure commit."""
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
    bp = Path("/tmp") / f"final-gap-backup-{path.name}-{os.getpid()}"
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
    for line in output.splitlines()[-12:]:
        print(line)
    if is_test_failure(output):
        print("✓ MUTATION DETECTED (test failed as expected)")
        return True
    else:
        print("✗ MUTATION NOT DETECTED (test still passed — protection gap!)")
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
    print("BASELINE: confirm final-gap tests pass before mutations")
    print("━" * 80)
    code, output = run_test("tests/final-gap-mutation-guards.test.ts")
    for line in output.splitlines()[-8:]:
        print(line)
    if is_test_failure(output):
        print("✗ Baseline FAILS — fix before mutations")
        return 1
    print("✓ Baseline passes")

    results = []

    # ─── Gap A: remove central gate from auto-finalize ──────────────────────
    print("\nMUTATION GA: remove central gate call from auto-finalize")
    target = ROOT / "app/api/tenders/[id]/auto-finalize/route.ts"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '  const centralGate = await assertTenderReadyForGenerationAndExport({\n    prisma,\n    tenderId,\n    userId: actor.id,\n    purpose: "final-zip",\n  });\n  if (!centralGate.ok) {\n    return NextResponse.json({\n      error: `Auto-finalize blocked: ${centralGate.blockerDetail ?? centralGate.blockerCode}`,\n      code: centralGate.blockerCode,\n      blockers: [centralGate.blockerDetail ?? "Tender is not ready for finalization."],\n      nextAction: centralGate.blockerCode === "BUILD_PLAN_NOT_CONFIRMED" ? "BUILD_SUBMISSION_PLAN" : "RERUN_AI_ANALYZE",\n    }, { status: 422 });\n  }',
        '  // MUTATION: central gate call removed',
    )
    if mutated:
        result = check_mutation("remove central gate from auto-finalize", "tests/final-gap-mutation-guards.test.ts")
        results.append(("GA: remove central gate from auto-finalize", result))
    restore(target, bp)

    # ─── Gap C: remove auditOnly from approve-analysis response ─────────────
    print("\nMUTATION GC: remove auditOnly from approve-analysis response")
    target = ROOT / "app/api/tenders/[id]/approve-analysis/route.ts"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '    return NextResponse.json({\n      success: true,\n      approved: true,\n      analysisSource: source,\n      auditOnly: true,\n      message: "Human approval recorded as AUDIT-ONLY. It does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP. Re-run AI Analyze with healthy providers to obtain a genuine AI analysis that authorizes release.",\n    });',
        '    return NextResponse.json({ success: true, approved: true, analysisSource: source });',
    )
    if mutated:
        result = check_mutation("remove auditOnly from approve-analysis", "tests/final-gap-mutation-guards.test.ts")
        results.append(("GC: remove auditOnly from approve-analysis", result))
    restore(target, bp)

    # ─── Gap D: re-introduce fail-open catch in tender-generation-readiness ──
    print("\nMUTATION GD: re-introduce fail-open catch in tender-generation-readiness")
    target = ROOT / "lib/tender-generation-readiness.ts"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '  let analysisGate: { ok: true } | { ok: false; code: string; message: string; nextAction: string };\n  try {\n    analysisGate = await assertAnalysisReadyForFinalGeneration(client, tenderId, tender);\n  } catch {\n    analysisGate = {\n      ok: false,\n      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",\n      message: "Analysis readiness gate could not be evaluated (database or resolver error). Generation is blocked until the gate can run successfully.",\n      nextAction: "RERUN_AI_ANALYZE",\n    };\n  }',
        '  const analysisGate = await assertAnalysisReadyForFinalGeneration(client, tenderId, tender).catch(() => ({ ok: true as const }));',
    )
    if mutated:
        result = check_mutation("re-introduce fail-open catch", "tests/final-gap-mutation-guards.test.ts")
        results.append(("GD: re-introduce fail-open catch", result))
    restore(target, bp)

    # ─── Gap E: remove HUMAN_APPROVED block from export-readiness ───────────
    print("\nMUTATION GE: remove HUMAN_APPROVED block from export-readiness")
    target = ROOT / "lib/engine/export-readiness.ts"
    bp = backup(target)
    # Remove the entire HUMAN_APPROVED_REGEX_FALLBACK branch so the test
    # (which checks for the ANALYSIS_FALLBACK_AUDIT_ONLY code) fails.
    mutated = mutate_file(
        target,
        '''  if (analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    blockers.push(tenderBlocker(
      "ANALYSIS_FALLBACK_AUDIT_ONLY",
      "Tender analysis was human-approved as audit-only. Human approval no longer authorizes export.",
      "Re-run AI Analyze with healthy providers to obtain a genuine AI analysis. The audit-only approval is preserved for record-keeping but does NOT unblock export.",
      "HIGH",
    ));
  } else if''',
        '''  if''',
    )
    if mutated:
        result = check_mutation("remove HUMAN_APPROVED block from export-readiness", "tests/final-gap-mutation-guards.test.ts")
        results.append(("GE: remove HUMAN_APPROVED block from export-readiness", result))
    restore(target, bp)

    # ─── Gap F: remove ACTIVE-file filter from ai-analyze ───────────────────
    print("\nMUTATION GF: remove ACTIVE-file filter from ai-analyze (streaming path)")
    target = ROOT / "app/api/tenders/[id]/ai-analyze/route.ts"
    bp = backup(target)
    mutated = mutate_file(
        target,
        '        const validTenderFileIds = new Set(\n          tenderRecord.files\n            .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")\n            .map((f) => f.id),\n        );',
        '        const validTenderFileIds = new Set(tenderRecord.files.map((f) => f.id));',
    )
    if mutated:
        result = check_mutation("remove ACTIVE-file filter from ai-analyze", "tests/final-gap-mutation-guards.test.ts")
        results.append(("GF: remove ACTIVE-file filter from ai-analyze", result))
    restore(target, bp)

    # ─── Summary ─────────────────────────────────────────────────────────────
    print("\n" + "━" * 80)
    print("FINAL GAP-CLOSURE MUTATION CHECK SUMMARY")
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
