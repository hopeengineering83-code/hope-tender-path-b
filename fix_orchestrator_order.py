import sys

with open('lib/engine/tender-lifecycle-orchestrator.ts', 'r') as f:
    lines = f.readlines()

out = []
for line in lines:
    if '  const extractionOk = isExtractionAcceptableForGeneration(effectiveFiles);' in line:
        continue
    if '  const extractionExportOk = isExtractionAcceptableForExport(effectiveFiles);' in line:
        continue
    if '  const metadataOk = !meta.blockingForExport;' in line:
        continue
    if '  const metadataGenOk = !meta.blockingForGeneration;' in line:
        continue

    if '    assessTenderMetadataCompleteness(metaInput);' in line:
        out.append(line)
        out.append('  const extractionOk = isExtractionAcceptableForGeneration(effectiveFiles);\n')
        out.append('  const extractionExportOk = isExtractionAcceptableForExport(effectiveFiles);\n')
        out.append('  const metadataOk = !meta.blockingForExport;\n')
        out.append('  const metadataGenOk = !meta.blockingForGeneration;\n')
    else:
        out.append(line)

with open('lib/engine/tender-lifecycle-orchestrator.ts', 'w') as f:
    f.writelines(out)
