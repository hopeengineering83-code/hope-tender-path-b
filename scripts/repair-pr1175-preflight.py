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
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))
'''
if text.count(old) != 1:
    raise SystemExit(f"replace_once function mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("repair preflight applied")
