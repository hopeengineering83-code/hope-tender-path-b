from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "app/api/tenders/[id]/ai-analyze/route.ts"
text = path.read_text(encoding="utf-8")


def once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)


def all_matches(old: str, new: str, expected: int, label: str) -> None:
    global text
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}")
    text = text.replace(old, new)


once(
    'import { safeParseJsonObject } from "../../../../../lib/safe-json";\n',
    'import { safeParseJsonObject } from "../../../../../lib/safe-json";\nimport { buildTenderFileSourceHeader, enrichRequirementsWithSourceLinkage } from "../../../../../lib/ai-source-linkage";\n',
    "source helper import",
)

all_matches(
    '? `[FILE: ${f.originalFileName}]\\n${extractRelevantSections(stripExtractionHeader(f.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`\n            : `[FILE: ${f.originalFileName} ${f.classification ?? ""}]`',
    '? `${buildTenderFileSourceHeader(f)}\\n${extractRelevantSections(stripExtractionHeader(f.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`\n            : `${buildTenderFileSourceHeader(f)}\\n[NO_EXTRACTED_TEXT] ${f.classification ?? ""}`',
    2,
    "stable file headers",
)

once(
    '            const aiResult = aiMeta.result;',
    '            const aiResult = {\n              ...aiMeta.result,\n              requirements: enrichRequirementsWithSourceLinkage(aiMeta.result.requirements, tenderRecord.files),\n            };',
    "stream linkage enrichment",
)

once(
    '        const aiResult = aiMeta.result;',
    '        const aiResult = {\n          ...aiMeta.result,\n          requirements: enrichRequirementsWithSourceLinkage(aiMeta.result.requirements, tenderRecord.files),\n        };',
    "non-stream linkage enrichment",
)

old_fallback = '''    } else {
      // Legacy path: no job tracking (rare — only if job creation failed).
      await prisma.$transaction(async (tx) => {
        await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
        for (const req of result.requirements) {
          await tx.tenderRequirement.create({ data: { tenderId: id, ...req } });
        }
        const previousNotes = (tenderRecord.notes ?? "")
          .split("\\n")
          .filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()));
        const notes = [...previousNotes, `Analysis source: Regex fallback (${fallbackDiagnostics.category}).`, diagnosticsLine].filter(Boolean).join("\\n").trim() || null;
        const tenderStatus = errorMessage ? "ANALYSIS_REQUIRES_REVIEW" : "FALLBACK_DRAFT_CREATED";
        await tx.tender.update({
          where: { id },
          data: {
            analysisSummary: `${result.summary}\\n\\nFast fallback used because AI analysis did not complete. ${diagnosticsLine}`,
            exactFileNaming: JSON.stringify(result.exactFileNaming),
            exactFileOrder: JSON.stringify(result.exactFileOrder),
            notes,
            status: tenderStatus,
            stage: "ANALYSIS",
            analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
          },
        });
      });
    }'''
new_fallback = '''    } else {
      // No staging record means fallback output cannot be reviewed or resumed safely.
      // Preserve all canonical requirements and metadata rather than replacing them.
      throw new AiAnalyzeCheckpointPersistenceError(
        "AI Analyze could not create a staging job. Existing canonical requirements were preserved; retry after database connectivity is restored.",
      );
    }'''
once(old_fallback, new_fallback, "remove destructive no-job fallback")

once(
    '                      sourcePageNumber: req.sourcePage ?? null, sourceExactQuote: req.sourceQuote ?? null,\n                      sourceExtractionMethod: effectiveExtractionMethod,\n                      sourceConfidence: typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0),',
    '                      sourceTenderFileId: req.sourceTenderFileId ?? null,\n                      sourcePageNumber: req.sourcePage ?? null, sourceExactQuote: req.sourceQuote ?? null,\n                      sourceExtractionMethod: req.sourceExtractionMethod ?? effectiveExtractionMethod,\n                      sourceConfidence: req.sourceConfidence ?? (typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0)),',
    "stream source persistence",
)

once(
    '                  sourcePageNumber: req.sourcePage ?? null,\n                  sourceExactQuote: req.sourceQuote ?? null,\n                  sourceExtractionMethod: effectiveExtractionMethodNonStreaming,\n                  sourceConfidence: typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0),',
    '                  sourceTenderFileId: req.sourceTenderFileId ?? null,\n                  sourcePageNumber: req.sourcePage ?? null,\n                  sourceExactQuote: req.sourceQuote ?? null,\n                  sourceExtractionMethod: req.sourceExtractionMethod ?? effectiveExtractionMethodNonStreaming,\n                  sourceConfidence: req.sourceConfidence ?? (typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0)),',
    "non-stream source persistence",
)

path.write_text(text, encoding="utf-8")
print("Patched AI Analyze route with stable source linkage and non-destructive fallback handling")
