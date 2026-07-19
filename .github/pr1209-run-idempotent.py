from pathlib import Path

path = Path('.github/pr1209-apply.py')
source = path.read_text()

old_helper = '''    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}: {pattern[:120]!r}; found {count}")
    file_path.write_text(updated)
'''
new_helper = '''    if count == 0:
        print(f"already corrected or pattern absent in {path}: {pattern[:80]!r}")
        return
    if count != 1:
        raise SystemExit(f"expected at most one match in {path}: {pattern[:120]!r}; found {count}")
    file_path.write_text(updated)
'''
if old_helper not in source:
    raise SystemExit('substitution helper contract changed unexpectedly')
source = source.replace(old_helper, new_helper, 1)

old_sanitize = '''    if old not in sanitize:
        raise SystemExit(f"sanitize contract not found: {old}")
    sanitize = sanitize.replace(old, new, 1)
'''
new_sanitize = '''    if old not in sanitize:
        print(f"sanitize contract already corrected or absent: {old}")
        continue
    sanitize = sanitize.replace(old, new, 1)
'''
if old_sanitize not in source:
    raise SystemExit('sanitize replacement loop contract changed unexpectedly')
source = source.replace(old_sanitize, new_sanitize, 1)

exec(compile(source, str(path), 'exec'), {'__name__': '__main__'})
