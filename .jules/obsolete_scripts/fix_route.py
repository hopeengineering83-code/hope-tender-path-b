import sys

path = 'app/api/tenders/[id]/generate/route.ts'
with open(path, 'r') as f:
    lines = f.readlines()

new_lines = []
skip = 0
for i, line in enumerate(lines):
    if skip > 0:
        skip -= 1
        continue
    if 'if (!planCheck.valid) {' in line and i + 1 < len(lines) and 'return NextResponse.json({' in lines[i+1]:
        new_lines.append(line)
        new_lines.append('        return NextResponse.json({\n')
        new_lines.append('          errorCode: "NO_SUBMISSION_PLAN",\n')
        new_lines.append('          error: "No submission plan exists. Build the submission plan before generating documents.",\n')
        new_lines.append('          blockers: ["Submission plan has not been built. Run Build Plan before generating documents."],\n')
        new_lines.append('          nextAction: "BUILD_SUBMISSION_PLAN",\n')
        new_lines.append('          diagnosticId: `no-plan-${tender.id}`,\n')
        new_lines.append('          plannedCount: planCheck.plannedCount,\n')
        new_lines.append('        }, { status: 400 });\n')
        new_lines.append('      }\n')

        # Search for the end of the original if block to skip it
        j = i + 1
        brace_count = 1
        while j < len(lines) and brace_count > 0:
            if '{' in lines[j]: brace_count += lines[j].count('{')
            if '}' in lines[j]: brace_count -= lines[j].count('}')
            j += 1
        skip = j - i - 1
    else:
        new_lines.append(line)

with open(path, 'w') as f:
    f.writelines(new_lines)
