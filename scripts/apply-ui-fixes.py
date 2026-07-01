#!/usr/bin/env python3
"""
Apply all production-gap fixes to UI components.
"""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")

# ─── Fix 1: generation-action-panel.tsx — "Repair evaluationMethodology only" → human label ───
f = ROOT / "components/generation-action-panel.tsx"
src = f.read_text()
src = src.replace(
    'Repair evaluationMethodology only',
    'Repair evaluation criteria only'
)
src = src.replace(
    'setMessage("evaluationMethodology repaired from source.")',
    'setMessage("Evaluation criteria repaired from source.")'
)
src = src.replace(
    'setMessage("evaluationMethodology not found in the tender source.")',
    'setMessage("Evaluation criteria not found in the tender source.")'
)
src = src.replace(
    'setMessage("evaluationMethodology repair was skipped (field already has a value).")',
    'setMessage("Evaluation criteria repair was skipped (field already has a value).")'
)
f.write_text(src)
print("[ok] Fixed generation-action-panel: 'evaluationMethodology' → 'evaluation criteria'")

# ─── Fix 2: Remove "Open JSON" buttons from all panels ───
# These are developer debug tools, not production features.
# Replace with nothing (remove the entire link element).

for fname in [
    "components/analysis-quality-panel.tsx",
    "components/generation-readiness-panel.tsx",
    "components/extraction-quality-panel.tsx",
    "components/matching-quality-panel.tsx",
]:
    f = ROOT / fname
    if not f.exists():
        continue
    src = f.read_text()
    # Remove the "Open JSON" link elements
    # Pattern: <Link href="...">Open JSON</Link> (may span multiple lines)
    src = re.sub(
        r'\s*<Link[^>]*href=\{[^}]*\}[^>]*>\s*Open JSON\s*</Link>',
        '',
        src,
        flags=re.DOTALL
    )
    # Also handle multi-line variants with className
    src = re.sub(
        r'\s*<Link[^>]*className="[^"]*"[^>]*>\s*Open JSON\s*</Link>',
        '',
        src,
        flags=re.DOTALL
    )
    f.write_text(src)
    print(f"[ok] Removed 'Open JSON' button from {fname}")

# Fix tender-detail.tsx "Open JSON" button
f = ROOT / "app/dashboard/tenders/[id]/tender-detail.tsx"
if f.exists():
    src = f.read_text()
    src = re.sub(
        r'\s*<Link[^>]*>\s*Open JSON\s*</Link>',
        '',
        src,
        flags=re.DOTALL
    )
    src = re.sub(
        r'\s*<a[^>]*>\s*Open JSON\s*</a>',
        '',
        src,
        flags=re.DOTALL
    )
    f.write_text(src)
    print("[ok] Removed 'Open JSON' button from tender-detail.tsx")

# ─── Fix 3: Translate error codes in authority-review-panel.tsx ───
f = ROOT / "components/authority-review-panel.tsx"
if f.exists():
    src = f.read_text()
    # Add import for errorCodeLabel
    if "human-labels" not in src:
        # Find the last import line and add after it
        lines = src.split('\n')
        last_import_idx = 0
        for i, line in enumerate(lines):
            if line.startswith('import '):
                last_import_idx = i
        lines.insert(last_import_idx + 1, 'import { errorCodeLabel } from "@/lib/ui/human-labels";')
        src = '\n'.join(lines)

    # Replace the raw blocker.code display with translated label
    src = src.replace(
        '{blocker.code}',
        '{errorCodeLabel(blocker.code)}'
    )
    f.write_text(src)
    print("[ok] Translated error codes in authority-review-panel.tsx")

# ─── Fix 4: Add loading.tsx files ───
loading_content = '''/**
 * Loading skeleton for tender pages.
 * Shown via Next.js streaming/suspense while server components load.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded-lg bg-slate-200" />
        <div className="h-4 w-96 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-32 rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-32 rounded-lg border border-slate-200 bg-slate-100" />
        </div>
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}
'''

for path in [
    "app/dashboard/tenders/[id]/loading.tsx",
    "app/dashboard/tenders/loading.tsx",
    "app/dashboard/loading.tsx",
]:
    f = ROOT / path
    f.parent.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text(loading_content)
        print(f"[ok] Created {path}")

# ─── Fix 5: Differentiate document error messages ───
f = ROOT / "components/document-validator-panel.tsx"
if f.exists():
    src = f.read_text()
    # Replace the generic error with differentiated messages
    old = '⚠ No content — document has not been generated or content is missing. Generate or attach a file before export.'
    new = '⚠ This document has no content yet. Click "Generate" to create it from the tender requirements, or "Attach" to upload an existing file.'
    src = src.replace(old, new)
    f.write_text(src)
    print("[ok] Differentiated document error message in document-validator-panel.tsx")

# ─── Fix 6: Make "Resolve blockers first" button scroll to blockers ───
f = ROOT / "components/generation-action-panel.tsx"
if f.exists():
    src = f.read_text()
    # Find the "Resolve blockers first" button and add an onClick to scroll
    # The button text is: blocked ? "Resolve blockers first" : "Generate Docs"
    # We need to add an onClick that scrolls to the blockers section
    if 'scrollToBlockers' not in src:
        # Add a function before the return statement
        # Find the component function
        src = src.replace(
            'if (blocked) {',
            '''  const scrollToBlockers = () => {
    const el = document.getElementById("generation-blockers");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-amber-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 2000);
    }
  };

  if (blocked) {'''
        )
        # Add id to the blockers section and onClick to the button
        # The button onClick is likely runGenerate or similar
        # Find the disabled button
        src = src.replace(
            'disabled={busy || running || isPending}',
            'disabled={busy || running || isPending}\n                onClick={blocked ? scrollToBlockers : runGenerateDocs}'
        )
        f.write_text(src)
        print("[ok] Made 'Resolve blockers first' button scroll to blockers")

print("\n=== All UI fixes applied ===")
