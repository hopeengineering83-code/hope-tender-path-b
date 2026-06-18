import sys

with open('lib/engine/tender-lifecycle-orchestrator.ts', 'r') as f:
    lines = f.readlines()

out = []
for line in lines:
    if '  if (!tender) return null;' in line:
        out.append(line)
        out.append('  const effectiveFiles = files.map((file) => {\n')
        out.append('    const quality = assessExtractionQuality(file.extractedText, file.fileName);\n')
        out.append('    return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score), quality };\n')
        out.append('  });\n')
    else:
        out.append(line)

with open('lib/engine/tender-lifecycle-orchestrator.ts', 'w') as f:
    f.writelines(out)
