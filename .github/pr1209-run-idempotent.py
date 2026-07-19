from pathlib import Path

path = Path('.github/pr1209-apply.py')
source = path.read_text()
old = '''    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}: {pattern[:120]!r}; found {count}")
    file_path.write_text(updated)
'''
new = '''    if count == 0:
        print(f"already corrected or pattern absent in {path}: {pattern[:80]!r}")
        return
    if count != 1:
        raise SystemExit(f"expected at most one match in {path}: {pattern[:120]!r}; found {count}")
    file_path.write_text(updated)
'''
if old not in source:
    raise SystemExit('substitution helper contract changed unexpectedly')
source = source.replace(old, new, 1)
exec(compile(source, str(path), 'exec'), {'__name__': '__main__'})
