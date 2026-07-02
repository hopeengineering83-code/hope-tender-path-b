#!/usr/bin/env python3
"""Fix test mocks to include the actual quote in sourceFileExtractedText."""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")

test_files = [
    "tests/grounding-and-buildplan-enforcement.test.ts",
    "tests/build-plan-release-safety.test.ts",
    "tests/generation-gate-hardened.test.ts",
    "tests/route-behavioral-gate.test.ts",
    "tests/generation-readiness-gate.test.ts",
    "tests/gate-safety-behavioral.test.ts",
]

for tf in test_files:
    p = ROOT / tf
    if not p.exists():
        continue
    content = p.read_text()
    original = content
    
    # For each requirement object, find the sourceExactQuote and ensure
    # sourceFileExtractedText contains it.
    # Pattern: sourceExactQuote: "..." ... sourceFileExtractedText: "..."
    # We need to replace the sourceFileExtractedText with one that contains the quote.
    
    def fix_requirement(m):
        quote_match = re.search(r'sourceExactQuote:\s*"([^"]*)"', m.group(0))
        if not quote_match:
            return m.group(0)
        quote = quote_match.group(1)
        # Create extracted text that contains the quote
        extracted = f"This tender document contains the following: {quote}. Additional context for the tender file extraction."
        # Replace the sourceFileExtractedText value
        result = re.sub(
            r'sourceFileExtractedText:\s*"[^"]*"',
            f'sourceFileExtractedText: "{extracted}"',
            m.group(0)
        )
        return result
    
    # Match requirement objects that have both sourceExactQuote and sourceFileExtractedText
    content = re.sub(
        r'\{[^}]*sourceExactQuote:\s*"[^"]*"[^}]*sourceFileExtractedText:\s*"[^"]*"[^}]*\}',
        fix_requirement,
        content
    )
    
    if content != original:
        p.write_text(content)
        print(f"  Fixed {tf}")

print("Done.")
