import sys

with open('lib/engine/tender-lifecycle-orchestrator.ts', 'r') as f:
    lines = f.readlines()

out = []
for line in lines:
    if 'import { assessExtractionQuality } from "../../lib/extraction-quality";' in line:
        continue
    if 'import { isExtractionAcceptableForGeneration, isExtractionAcceptableForExport } from "./extraction-quality-gate";' in line:
        continue
    if 'import type { PrismaClient } from "@prisma/client";' in line:
        out.append(line)
        out.append('import { assessExtractionQuality } from "../../lib/extraction-quality";\n')
        out.append('import { isExtractionAcceptableForGeneration, isExtractionAcceptableForExport } from "./extraction-quality-gate";\n')
    else:
        out.append(line)

with open('lib/engine/tender-lifecycle-orchestrator.ts', 'w') as f:
    f.writelines(out)
