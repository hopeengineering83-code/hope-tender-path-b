from pathlib import Path

path = Path("scripts/repair-pr1175-final-gaps.py")
text = path.read_text(encoding="utf-8")
old = '''def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))
'''
new = '''def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        if path == "lib/engine/matching.ts" and old.startswith("      const trustLabel = trustLevelLabel(trustLevel);") and count == 2:
            write(path, text.replace(old, new, 1))
            return
        if path == "app/api/tenders/[id]/ai-rematch/route.ts" and old == "    complianceStatePreserved: true," and count == 2:
            index = text.rfind(old)
            write(path, text[:index] + new + text[index + len(old):])
            return
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))
'''
if text.count(old) != 1:
    raise SystemExit(f"replace_once function mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

matching_test = Path("tests/matching-fail-closed-negative-tests.test.ts")
test_text = matching_test.read_text(encoding="utf-8")
stale = '''    // Must NOT import from vault-review-provenance (that's PR #1146's scope)
    assert.ok(
      !src.includes("vault-review-provenance"),
      "matching-eligibility.ts must NOT reference vault-review-provenance (PR #1146 scope)",
    );
'''
canonical = '''    // The provenance module is now integrated and is the canonical matching authority.
    assert.ok(
      src.includes("vault-review-provenance") && src.includes("canUseVaultRecord"),
      "matching-eligibility.ts must delegate to the canonical durable provenance authority",
    );
'''
if test_text.count(stale) != 1:
    raise SystemExit(f"stale provenance assertion mismatch: {test_text.count(stale)}")
test_text = test_text.replace(stale, canonical, 1)
needle = '''    assert.match(src, /NO_REVIEW_TIMESTAMP/);
'''
replacement = '''    assert.match(src, /NO_REVIEW_TIMESTAMP/);
    assert.match(src, /NO_DURABLE_PROVENANCE/);
'''
if test_text.count(needle) != 1:
    raise SystemExit(f"rejection-code assertion mismatch: {test_text.count(needle)}")
matching_test.write_text(test_text.replace(needle, replacement, 1), encoding="utf-8")

print("repair preflight applied")
