import sys

path = 'app/api/tenders/[id]/generate-missing-plan-files/route.ts'
with open(path, 'r') as f:
    lines = f.readlines()

new_lines = []
skip = 0
for i, line in enumerate(lines):
    if skip > 0:
        skip -= 1
        continue
    if 'contentSummary: replaceWithOriginal' in line:
        new_lines.append('      contentSummary: `${replaceWithOriginal ? "REPLACE_WITH_ORIGINAL" : "SUPPORT_CONTROL"} ${file.notes && file.notes.includes("DERIVED_DRAFT_UNCONFIRMED") ? "DERIVED_DRAFT_UNCONFIRMED" : ""}`.trim(),\n')
        # skip until updatedAt
        j = i + 1
        while j < len(lines) and 'updatedAt:' not in lines[j]:
            j += 1
        skip = j - i - 1
    elif '?' in line and '`Replacement-control' in line:
        continue
    elif ': `Generated support-control' in line:
        continue
    else:
        new_lines.append(line)

with open(path, 'w') as f:
    f.writelines(new_lines)
