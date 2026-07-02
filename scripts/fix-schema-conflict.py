#!/usr/bin/env python3
"""Fix merge conflict markers in prisma/schema.prisma on the target branch."""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")
SCHEMA = ROOT / "prisma/schema.prisma"

# The correct BuildPlan model (no conflict markers, all fields present).
CORRECT_BUILDPLAN = '''model BuildPlan {
  id                String   @id @default(uuid())
  tenderId          String   @unique
  tender            Tender   @relation(fields: [tenderId], references: [id], onDelete: Cascade)
  // DRAFT | CONFIRMED | SUPERSEDED
  status            String   @default("DRAFT")
  revision          Int      @default(1)
  // Hash of tender file IDs + names (detects file additions, deletions, renames)
  contentHash       String
  // JSON array of file metadata at plan time: [{ fileId, fileName, order }]
  filesList         String   @default("[]")
  // JSON array of planned documents from buildSubmissionPlan()
  plannedDocuments  String   @default("[]")
  // JSON validation results
  validationJson    String?
  // Plan type: "EXPLICIT" (from exactFileNaming/exactFileOrder) or
  // "DERIVED" (from requirements) or "DERIVED_DRAFT" (fallback heuristic)
  planType          String   @default("DERIVED")
  // Items JSON (for #930 compatibility)
  itemsJson         String   @default("[]")
  // Audit trail — DRAFT/CONFIRMED service authoritative columns.
  // builtById is the user who built the DRAFT. confirmedById is the user
  // who confirmed it. confirmedRevision/confirmedContentHash snapshot the
  // revision+hash at confirmation time so post-confirmation drift is
  // detectable. Legacy createdBy/confirmedBy are retained as audit-only
  // aliases for backward compatibility with the submission-plan/build route.
  builtById            String?
  createdBy            String?
  confirmedById        String?
  confirmedBy          String?
  confirmedRevision    Int?
  confirmedContentHash String?
  confirmedAt          DateTime?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([contentHash])
}'''

def run(cmd, check=True):
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    if check and result.returncode != 0:
        print(f"FAILED: {cmd}")
        print(result.stderr)
        sys.exit(1)
    return result.stdout

# 1. Checkout target branch
print("1. Checking out target branch...")
run("git checkout hotfix/release-safety-consolidation")

# 2. Read the schema
print("2. Reading schema...")
content = SCHEMA.read_text()

# 3. Check for conflict markers
has_markers = "<<<<<<<" in content or ">>>>>>>" in content
print(f"   Has conflict markers: {has_markers}")

if has_markers:
    # 4. Find the BuildPlan model and replace it
    print("3. Replacing BuildPlan model...")
    import re
    # Match from "model BuildPlan {" to the closing "}"
    pattern = r'model BuildPlan \{[^}]*\}'
    new_content = re.sub(pattern, CORRECT_BUILDPLAN, content, count=1, flags=re.DOTALL)
    SCHEMA.write_text(new_content)
    print("   Schema written.")
else:
    print("   No conflict markers found — checking if fields are missing...")
    # Even without conflict markers, the schema might be missing fields
    if "builtById" not in content:
        print("   builtById missing — replacing BuildPlan model...")
        import re
        pattern = r'model BuildPlan \{[^}]*\}'
        new_content = re.sub(pattern, CORRECT_BUILDPLAN, content, count=1, flags=re.DOTALL)
        SCHEMA.write_text(new_content)
        print("   Schema written.")
    else:
        print("   Schema already has all fields — no fix needed.")

# 5. Verify no conflict markers remain
content = SCHEMA.read_text()
if "<<<<<<<" in content or ">>>>>>>" in content:
    print("ERROR: Conflict markers still present!")
    sys.exit(1)
print("4. No conflict markers remain.")

# 6. Validate
print("5. Validating schema...")
import os
env = {**os.environ, "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public"}
result = subprocess.run("npx prisma validate", cwd=ROOT, capture_output=True, text=True, env=env, shell=True)
print(result.stdout)
if result.returncode != 0:
    print("VALIDATION FAILED!")
    print(result.stderr)
    sys.exit(1)

# 7. Regenerate Prisma client
print("6. Regenerating Prisma client...")
result = subprocess.run("npx prisma generate", cwd=ROOT, capture_output=True, text=True, env=env, shell=True)
print(result.stdout[-200:] if len(result.stdout) > 200 else result.stdout)
if result.returncode != 0:
    print("GENERATE FAILED!")
    print(result.stderr)
    sys.exit(1)

print("\n✓ Schema fixed and validated successfully.")
