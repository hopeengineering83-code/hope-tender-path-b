from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
path = root / "lib/ai.ts"
text = path.read_text(encoding="utf-8")


def sub_once(pattern: str, replacement: str, label: str, flags: int = 0) -> None:
    global text
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    text = updated


if "sourceFileToken?: string | null;" not in text:
    sub_once(
        r'(export type AIRequirement = \{[\s\S]*?\n\s*sourceQuote\?: string \| null;)',
        r'\1\n  sourceFileToken?: string | null;\n  sourceFileName?: string | null;\n  sourceTenderFileId?: string | null;\n  sourceExtractionMethod?: "text" | "ocr" | "mixed" | null;\n  sourceConfidence?: number | null;\n  sourceLinkageWarning?: string | null;',
        "AIRequirement source fields",
    )

if "const existingHasSource" not in text:
    sub_once(
        r'(\s+const existing = reqByKey\.get\(key\);)\n\s+if \(!existing \|\| \(req\.description\?\.length \?\? 0\) > \(existing\.description\?\.length \?\? 0\)\) \{\n\s+reqByKey\.set\(key, req\);\n\s+\}',
        r'\1\n      const existingHasSource = Boolean(existing?.sourceFileToken || existing?.sourceTenderFileId || existing?.sourceFileName || existing?.sourceQuote);\n      const candidateHasSource = Boolean(req.sourceFileToken || req.sourceTenderFileId || req.sourceFileName || req.sourceQuote);\n      if (!existing || (candidateHasSource && !existingHasSource) || (candidateHasSource === existingHasSource && (req.description?.length ?? 0) > (existing.description?.length ?? 0))) {\n        reqByKey.set(key, req);\n      }',
        "source-aware merge",
    )

if '"sourceFileToken": "copy the exact TFILE:<id> token' not in text:
    sub_once(
        r'(\s+"sourcePage": page_number_integer_or_null,\n\s+"sourceQuote": "verbatim 1-2 sentence snippet from the tender that this requirement is drawn from, or null")',
        r'\1,\n       "sourceFileToken": "copy the exact TFILE:<id> token from the nearest [TENDER_FILE|...] header, or null",\n       "sourceFileName": "copy the exact NAME shown in that same tender-file header, or null"',
        "source fields in prompt schema",
    )

if "SOURCE FILE RULE" not in text:
    sub_once(
        r'(- evaluationMethodology must be actionable: "Score criterion X by doing Y using evidence Z" — not just a list of criteria\.\n)',
        r'\1- SOURCE FILE RULE — every requirement must copy the exact TFILE:<id> token and file name from the [TENDER_FILE|...] header containing its source quote. Never guess or invent a token. Return null when the source file is not visible in this chunk.\n',
        "source rule in prompt",
    )

if "sourceFileToken: typeof r.sourceFileToken" not in text:
    sub_once(
        r'(\s+sourceQuote: typeof r\.sourceQuote === "string" \? r\.sourceQuote\.trim\(\)\.slice\(0, 500\) \|\| null : null,)',
        r'\1\n                sourceFileToken: typeof r.sourceFileToken === "string" ? r.sourceFileToken.trim().slice(0, 200) || null : null,\n                sourceFileName: typeof r.sourceFileName === "string" ? r.sourceFileName.trim().slice(0, 500) || null : null,',
        "source field sanitizer",
    )

path.write_text(text, encoding="utf-8")
print("Patched lib/ai.ts source-linkage fields, prompt, sanitizer, and merge policy")
