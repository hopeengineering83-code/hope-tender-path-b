import sys
import os

# 1. Fix auto-finalize route imports
path = 'app/api/tenders/[id]/auto-finalize/route.ts'
if os.path.exists(path):
    with open(path, 'r') as f:
        content = f.read()
    if 'isExtractionAcceptableForExport' not in content:
        content = content.replace('isExtractionAcceptableForGeneration', 'isExtractionAcceptableForGeneration, isExtractionAcceptableForExport')
    with open(path, 'w') as f:
        f.write(content)

# 2. Fix re-extract-metadata route imports
path = 'app/api/tenders/[id]/re-extract-metadata/route.ts'
if os.path.exists(path):
    with open(path, 'r') as f:
        lines = f.readlines()
    if not any('extraction-quality' in line for line in lines):
        lines.insert(20, 'import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../../lib/extraction-quality";\n')
    with open(path, 'w') as f:
        f.writelines(lines)

# 3. Fix tender-lifecycle-orchestrator
path = 'lib/engine/tender-lifecycle-orchestrator.ts'
if os.path.exists(path):
    with open(path, 'r') as f:
        lines = f.readlines()

    new_lines = []
    import_added = False
    for line in lines:
        if not import_added and 'from "./analysis-source";' in line:
            new_lines.append('import { assessExtractionQuality } from "../../lib/extraction-quality";\n')
            new_lines.append('import { isExtractionAcceptableForGeneration, isExtractionAcceptableForExport } from "./extraction-quality-gate";\n')
            import_added = True

        if '  const meta: MetadataCompletenessReport =' in line:
            new_lines.append('  const extractionOk = isExtractionAcceptableForGeneration(effectiveFiles);\n')
            new_lines.append('  const extractionExportOk = isExtractionAcceptableForExport(effectiveFiles);\n')
            new_lines.append('  const metadataOk = !meta.blockingForExport;\n')
            new_lines.append('  const metadataGenOk = !meta.blockingForGeneration;\n\n')

        new_lines.append(line)

    with open(path, 'w') as f:
        f.writelines(new_lines)

# 4. Fix MetadataCompletenessInput interface
path = 'lib/engine/tender-metadata-completeness.ts'
if os.path.exists(path):
    with open(path, 'r') as f:
        content = f.read()
    if 'metadataContaminated?: boolean | null;' not in content:
        content = content.replace('submissionEmails?: string | null;', 'submissionEmails?: string | null;\n  metadataContaminated?: boolean | null;')
    with open(path, 'w') as f:
        f.write(content)
