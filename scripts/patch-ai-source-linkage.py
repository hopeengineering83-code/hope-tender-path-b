from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "lib/ai.ts"
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    '  sourcePage?: number | null;\n  sourceQuote?: string | null;\n};',
    '  sourcePage?: number | null;\n  sourceQuote?: string | null;\n  sourceFileToken?: string | null;\n  sourceFileName?: string | null;\n  sourceTenderFileId?: string | null;\n  sourceExtractionMethod?: "text" | "ocr" | "mixed" | null;\n  sourceConfidence?: number | null;\n  sourceLinkageWarning?: string | null;\n};',
    "AIRequirement source fields",
)

replace_once(
    '      const existing = reqByKey.get(key);\n      if (!existing || (req.description?.length ?? 0) > (existing.description?.length ?? 0)) {\n        reqByKey.set(key, req);\n      }',
    '      const existing = reqByKey.get(key);\n      const existingHasSource = Boolean(existing?.sourceFileToken || existing?.sourceTenderFileId || existing?.sourceFileName || existing?.sourceQuote);\n      const candidateHasSource = Boolean(req.sourceFileToken || req.sourceTenderFileId || req.sourceFileName || req.sourceQuote);\n      if (!existing || (candidateHasSource && !existingHasSource) || (candidateHasSource === existingHasSource && (req.description?.length ?? 0) > (existing.description?.length ?? 0))) {\n        reqByKey.set(key, req);\n      }',
    "source-aware merge",
)

replace_once(
    '       "sourcePage": page_number_integer_or_null,\n       "sourceQuote": "verbatim 1-2 sentence snippet from the tender that this requirement is drawn from, or null"',
    '       "sourcePage": page_number_integer_or_null,\n       "sourceQuote": "verbatim 1-2 sentence snippet from the tender that this requirement is drawn from, or null",\n       "sourceFileToken": "copy the exact TFILE:<id> token from the nearest [TENDER_FILE|...] header, or null",\n       "sourceFileName": "copy the exact NAME shown in that same tender-file header, or null"',
    "source fields in prompt schema",
)

replace_once(
    '- evaluationMethodology must be actionable: "Score criterion X by doing Y using evidence Z" — not just a list of criteria.\n',
    '- evaluationMethodology must be actionable: "Score criterion X by doing Y using evidence Z" — not just a list of criteria.\n- SOURCE FILE RULE — every requirement must copy the exact TFILE:<id> token and file name from the [TENDER_FILE|...] header containing its source quote. Never guess or invent a token. Return null when the source file is not visible in this chunk.\n',
    "source rule in prompt",
)

replace_once(
    '                sourcePage: typeof r.sourcePage === "number" && Number.isInteger(r.sourcePage) && r.sourcePage > 0 ? r.sourcePage : null,\n                sourceQuote: typeof r.sourceQuote === "string" ? r.sourceQuote.trim().slice(0, 500) || null : null,',
    '                sourcePage: typeof r.sourcePage === "number" && Number.isInteger(r.sourcePage) && r.sourcePage > 0 ? r.sourcePage : null,\n                sourceQuote: typeof r.sourceQuote === "string" ? r.sourceQuote.trim().slice(0, 500) || null : null,\n                sourceFileToken: typeof r.sourceFileToken === "string" ? r.sourceFileToken.trim().slice(0, 200) || null : null,\n                sourceFileName: typeof r.sourceFileName === "string" ? r.sourceFileName.trim().slice(0, 500) || null : null,',
    "source field sanitizer",
)

path.write_text(text, encoding="utf-8")
print("Patched lib/ai.ts source-linkage fields, prompt, sanitizer, and merge policy")
