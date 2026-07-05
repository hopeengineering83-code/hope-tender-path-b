#!/usr/bin/env python3
"""Add sourceFileExtractedText to test mock requirements."""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")

# For each test file, find requirement mocks and add sourceFileExtractedText
# that contains the quote
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
        print(f"  SKIP {tf} (not found)")
        continue
    content = p.read_text()
    original = content
    
    # Pattern: sourceFileActiveInTender: true followed by } or ,
    # We need to add sourceFileExtractedText after it.
    # But we need the quote value to include it in the extracted text.
    # Strategy: for each requirement object that has sourceExactQuote and sourceFileActiveInTender,
    # add sourceFileExtractedText that contains the quote.
    
    # Simple approach: replace `sourceFileActiveInTender: true` with
    # `sourceFileActiveInTender: true, sourceFileExtractedText: "..."` where
    # "..." is a long text that contains common quotes.
    # Since we don't know the exact quote at this point, use a generic text
    # that contains "meaningful" and "quote" which covers most test quotes.
    
    # Actually, better: use a function-like approach. For each occurrence,
    # extract the sourceExactQuote value from the same object and create
    # extracted text that contains it.
    
    # Simplest: add a generic extracted text that contains many common words
    # used in test quotes. This works because the check is `fileText.includes(normalizedQuote)`.
    generic_text = "This tender requires a meaningful source quote for the technical proposal. Another meaningful source quote for grounding. Third requirement source quote for testing."
    
    # Replace occurrences where sourceFileActiveInTenter: true is NOT already
    # followed by sourceFileExtractedText
    def replacer(m):
        if 'sourceFileExtractedText' in content[m.end():m.end()+200]:
            return m.group(0)
        return m.group(0) + f', sourceFileExtractedText: "{generic_text}"'
    
    content = re.sub(r'sourceFileActiveInTender:\s*true(?!\s*,\s*sourceFileExtractedText)', replacer, content)
    
    if content != original:
        p.write_text(content)
        print(f"  Updated {tf}")
    else:
        print(f"  No changes in {tf}")

print("\nDone.")
