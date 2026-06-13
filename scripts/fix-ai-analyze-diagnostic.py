from pathlib import Path

path = Path(__file__).resolve().parents[1] / "app/api/tenders/[id]/ai-analyze/route.ts"
text = path.read_text(encoding="utf-8")
old = '''        id,
        null,
        contentHash.slice(0, 8),
        new Error("AI Analyze could not create a staging job; canonical requirements were preserved."),'''
new = '''        id,
        null,
        "no-job",
        new Error("AI Analyze could not create a staging job; canonical requirements were preserved."),'''
if text.count(old) != 1:
    raise RuntimeError(f"checkpoint diagnostic patch: expected one match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Fixed no-job checkpoint diagnostic prefix")
